import { describe, it, expect } from "vitest";
import { publicClient, serviceClient } from "./helpers";

// The Custom Access Token Hook (see the schema migration) injects `user_role`
// and `company_id` claims from the profiles table. It deliberately does NOT
// overwrite the standard `role` claim — GoTrue sets that to the Postgres role
// ('authenticated'/'anon') and PostgREST does SET ROLE on it, so writing
// 'operator' there would break every request. Hence we assert on `user_role`.
const HOOK_FAILURE =
  "Access token hook not applied — check that the migration grants execute on " +
  "custom_access_token_hook to supabase_auth_admin, and that the hook is enabled in the dashboard.";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Set it in .env.test (see .env.example).`,
    );
  }
  return value;
}

/** Decode a JWT payload — base64url of the middle segment, no library needed. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split(".")[1];
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(base64, "base64").toString("utf8");
  return JSON.parse(json);
}

describe("custom access token hook claims (survives db:reset)", () => {
  it("a seeded operator gets user_role=operator + company_id matching its profile", async () => {
    const client = publicClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: required("TEST_OPERATOR_EMAIL"),
      password: required("TEST_OPERATOR_PASSWORD"),
    });
    expect(error, `operator sign-in failed: ${error?.message}`).toBeNull();

    const session = data.session;
    expect(session, "operator sign-in returned no session").not.toBeNull();

    const claims = decodeJwtPayload(session!.access_token);
    expect(claims.user_role, HOOK_FAILURE).toBe("operator");
    expect(String(claims.company_id), HOOK_FAILURE).toMatch(UUID_RE);

    // The claim must equal the operator's profiles.company_id (source of truth).
    const svc = serviceClient();
    const { data: profile, error: profileError } = await svc
      .from("profiles")
      .select("company_id")
      .eq("id", session!.user.id)
      .single();
    expect(profileError).toBeNull();
    expect(claims.company_id, HOOK_FAILURE).toBe(profile!.company_id);
  });

  it("the seeded admin gets user_role=admin and no company_id", async () => {
    const client = publicClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: required("TEST_ADMIN_EMAIL"),
      password: required("TEST_ADMIN_PASSWORD"),
    });
    expect(error, `admin sign-in failed: ${error?.message}`).toBeNull();

    const session = data.session;
    expect(session, "admin sign-in returned no session").not.toBeNull();

    const claims = decodeJwtPayload(session!.access_token);
    expect(claims.user_role, HOOK_FAILURE).toBe("admin");
    expect(claims.company_id, HOOK_FAILURE).toBeUndefined();
  });

  it("a fresh anonymous session is a passenger with no company_id", async () => {
    const client = publicClient();
    const { data, error } = await client.auth.signInAnonymously();
    expect(error, `anonymous sign-in failed: ${error?.message}`).toBeNull();

    const session = data.session;
    expect(session, "anonymous sign-in returned no session").not.toBeNull();

    const claims = decodeJwtPayload(session!.access_token);
    // Passengers have no profiles row → hook sets 'passenger' (absent is also acceptable).
    expect(
      claims.user_role === "passenger" || claims.user_role === undefined,
      HOOK_FAILURE,
    ).toBe(true);
    expect(claims.company_id, HOOK_FAILURE).toBeUndefined();
  });
});
