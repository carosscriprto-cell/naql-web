import { describe, it, expect } from "vitest";
import { serviceClient } from "./helpers";

// T-SEC-1 (P0 [AUTO]) — grants audit.
//
// The public attack surface of this database is "which functions can a caller
// holding only the anon key execute". docs/V1_TEST_PLAN.md §7 fixes that list
// at nine. This asserts SET EQUALITY, not containment: a function that quietly
// becomes anon-callable fails this test exactly as loudly as one that stops
// being callable. Containment would only catch the second, and the second is
// the harmless direction — it breaks a feature, and a feature test catches it.
// The dangerous direction is silent.
//
// Postgres grants EXECUTE to PUBLIC by default on every newly created function,
// so a future RPC whose migration forgets `revoke ... from public` is
// anon-callable the moment it ships. That is the specific accident this guards,
// and it is why B5 added ten operator RPCs without widening the list below.
//
// Mechanism: public.role_executable_functions(role), a service-role-only
// SECURITY DEFINER function from
// 20260727170000_b7_grants_hardening.sql. pg_catalog is not reachable through
// PostgREST, and a direct-postgres client would be a new dependency that is
// unreliable behind a VPN (the DEV host resolves IPv6-only) and redundant on
// the CI local stack.

/** docs/BACKEND_V1.md §2/§3/§4 — the complete public RPC surface for v1. */
const ANON_CALLABLE = [
  "cancel_booking",
  "create_booking",
  "get_booking",
  "get_seat_map",
  "get_trip",
  "lock_seats",
  "lookup_booking",
  "release_lock",
  "search_trips",
].toSorted();

/**
 * Operator RPCs (B5, BACKEND_V1 §5). Every one is GRANTed to `authenticated`
 * only and role-checked inside; none may be anon-callable. Listed explicitly so
 * that granting one to anon by mistake fails by NAME here, not just as an
 * anonymous "the set has ten entries" diff.
 *
 * B6's admin RPCs (set_company_status, set_commission_rate, create_company,
 * cities/routes CRUD, commissions_by_month) belong in this list too — that
 * milestone is not implemented yet, so they are absent rather than expected.
 * Add them here in the same commit that adds them to the schema.
 */
const MUST_NOT_BE_ANON_CALLABLE = [
  // B5 — operator
  "create_trip",
  "update_trip",
  "cancel_trip",
  "get_manifest",
  "check_in",
  "check_in_by_pnr",
  "operator_cancel_booking",
  "create_bus",
  "update_bus",
  "operator_summary",
  // internal helpers — never reachable by a client of any kind
  "qr_hmac_secret",
  "generate_pnr",
  "booking_ticket",
  "operator_trip_json",
  "check_in_booking",
  "custom_access_token_hook",
  "role_executable_functions",
];

/** The three internals B7 revoked from service_role as defence in depth. */
const INTERNAL_HELPERS = ["qr_hmac_secret", "generate_pnr", "booking_ticket"];

const MISSING_FN =
  "role_executable_functions() is unavailable. If this is PGRST202/404 the function does not " +
  "exist on this database — apply supabase/migrations/20260727170000_b7_grants_hardening.sql " +
  "(supabase migration up / db reset on the local stack). This test is NOT skippable: an " +
  "unverified grant surface is the thing it exists to prevent.";

async function executableBy(role: string): Promise<string[]> {
  const { data, error } = await serviceClient().rpc("role_executable_functions", {
    p_role: role,
  });
  if (error) throw new Error(`${MISSING_FN} (${error.code ?? "?"}: ${error.message})`);
  return (data as string[]) ?? [];
}

/** "get_trip(text)" → "get_trip" */
const nameOf = (signature: string) => signature.split("(")[0];

describe("T-SEC-1 — anon EXECUTE grants", () => {
  it("anon may execute exactly the nine documented RPCs — no more, no fewer", async () => {
    const signatures = await executableBy("anon");
    const names = signatures.map(nameOf).toSorted();

    // Set equality. The diff on failure names the offender in both directions.
    expect(names, `granted signatures: ${JSON.stringify(signatures)}`).toEqual(
      ANON_CALLABLE,
    );

    // One routine per name: catches a second overload, which the name
    // comparison above would swallow.
    expect(signatures).toHaveLength(ANON_CALLABLE.length);
  });

  it("no operator RPC and no internal helper is anon-callable", async () => {
    // Redundant with the set equality above by construction, and deliberately
    // so: this one fails with the OFFENDING NAME in the message, which is what
    // someone reads at 2am after a migration mistake.
    const names = (await executableBy("anon")).map(nameOf);
    for (const fn of MUST_NOT_BE_ANON_CALLABLE) {
      expect(names, `${fn} must not be anon-callable`).not.toContain(fn);
    }
  });

  it("the operator RPCs ARE callable by `authenticated` (role-checked inside)", async () => {
    // The other half of the contract: they are not anon-callable because they
    // are granted to `authenticated` and guard on the user_role claim — not
    // because someone forgot to grant them at all, which would fail the same
    // way in the test above while silently breaking every operator.
    const names = (await executableBy("authenticated")).map(nameOf);
    for (const fn of [
      "create_trip", "update_trip", "cancel_trip", "get_manifest",
      "check_in", "check_in_by_pnr", "operator_cancel_booking",
      "create_bus", "update_bus", "operator_summary",
    ]) {
      expect(names, `${fn} must be callable by authenticated`).toContain(fn);
    }
  });
});

describe("T-SEC-1 — service_role EXECUTE grants (B7)", () => {
  it("service_role cannot execute the internal helpers", async () => {
    // 20260726100000's `alter default privileges ... grant all on functions to
    // service_role` handed these out implicitly; 20260727170000 revokes them.
    //
    // This removes a shortcut, not a capability: service_role has BYPASSRLS and
    // can read vault.decrypted_secrets and the booking tables directly. The
    // point is that a leaked service key can no longer ask the database for the
    // QR signing key in one rpc() call, or mint a ticket body for an arbitrary
    // booking id with no ownership check.
    const names = (await executableBy("service_role")).map(nameOf);
    for (const fn of INTERNAL_HELPERS) {
      expect(names, `service_role must not execute ${fn}`).not.toContain(fn);
    }
  });

  it("service_role keeps the introspection function it needs for this audit", async () => {
    const names = (await executableBy("service_role")).map(nameOf);
    expect(names).toContain("role_executable_functions");
  });
});
