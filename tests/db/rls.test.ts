import { describe, it, expect } from "vitest";
import { pooledAnonClient, publicClient, serviceClient } from "./helpers";

// Seeded fixture ids (see supabase/seed.sql)
const TRIP_PUBLISHED = "000000e1-0000-4000-8000-000000000001"; // tomorrow, published
const TRIP_DEPARTED = "000000e1-0000-4000-8000-000000000013"; // published but in the past
const TRIP_DRAFT = "000000e1-0000-4000-8000-000000000015"; // draft
const COMPANY_PENDING = "000000a1-0000-4000-8000-000000000004"; // pending
const COMPANY_APPROVED = "000000a1-0000-4000-8000-000000000001"; // الأمانة, publicly visible
const SCRATCH_LOCK = "000000ee-0000-4000-8000-00000000cec1"; // reserved-prefix scratch row

describe("RLS — public reads", () => {
  it("anonymous can read all cities", async () => {
    const { data, error } = await publicClient()
      .from("cities")
      .select("id,slug");
    expect(error).toBeNull();
    expect(data?.length).toBe(6);
  });

  it("anonymous can read published future trips, and only those", async () => {
    const { data, error } = await publicClient()
      .from("trips")
      .select("id,status,departure_at");
    expect(error).toBeNull();
    expect(data && data.length).toBeGreaterThan(0);

    const ids = new Set(data!.map((t) => t.id));
    expect(ids.has(TRIP_PUBLISHED)).toBe(true);

    // Every visible row is published and in the future.
    for (const t of data!) {
      expect(t.status).toBe("published");
      expect(new Date(t.departure_at).getTime()).toBeGreaterThan(Date.now());
    }
    // Draft and departed trips are invisible.
    expect(ids.has(TRIP_DRAFT)).toBe(false);
    expect(ids.has(TRIP_DEPARTED)).toBe(false);
  });

  it("anonymous cannot read a draft trip by id", async () => {
    const { data, error } = await publicClient()
      .from("trips")
      .select("id")
      .eq("id", TRIP_DRAFT);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("anonymous sees only approved companies (pending is hidden)", async () => {
    const { data, error } = await publicClient()
      .from("companies")
      .select("id,status");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThanOrEqual(3);
    expect(data!.every((c) => c.status === "approved")).toBe(true);
    expect(data!.some((c) => c.id === COMPANY_PENDING)).toBe(false);
  });
});

describe("RLS — private reads", () => {
  it("an anonymous user sees none of another user's bookings", async () => {
    // Pooled slot 20: any anon identity works — it owns no bookings, so the
    // owner policy must filter the seeded booking out. No need for a fresh user.
    const client = await pooledAnonClient(20);
    const { data, error } = await client.from("bookings").select("id");
    // authenticated has SELECT privilege, but the owner policy filters everything out.
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // T-SEC-3. profiles carries the operator/admin role and company_id — the
  // mapping an attacker would use to work out who runs which company, and the
  // table the access-token hook trusts. Its only SELECT policy is self-read
  // (plus supabase_auth_admin for the hook), so a passenger must see nothing:
  // not their own row (they have none), and certainly not an operator's.
  it("anonymous SELECT on profiles returns zero rows", async () => {
    const client = await pooledAnonClient(20);
    const { data, error } = await client.from("profiles").select("id,role,company_id");
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("a session-less caller gets zero rows from profiles too", async () => {
    // No grant to `anon` at all on this table — either an error or an empty set
    // is acceptable, leaking a row is not.
    const { data } = await publicClient().from("profiles").select("id");
    expect(data ?? []).toHaveLength(0);
  });
});

describe("RLS — direct writes are denied (writes go through RPCs)", () => {
  it("anonymous cannot INSERT a trip", async () => {
    const { error } = await publicClient()
      .from("trips")
      .insert({
        company_id: "000000a1-0000-4000-8000-000000000001",
        route_id: "000000e2-0000-4000-8000-000000000001",
        bus_id: "000000b1-0000-4000-8000-000000000011",
        departure_at: new Date(Date.now() + 86_400_000).toISOString(),
        arrival_at: new Date(Date.now() + 90_000_000).toISOString(),
        price: 50000,
        status: "published",
      });
    expect(error).not.toBeNull();
  });

  it("an anonymous (authenticated) user cannot INSERT a booking", async () => {
    const client = await pooledAnonClient(21); // pooled slot 21
    const { data: userRes } = await client.auth.getUser();
    const { error } = await client.from("bookings").insert({
      trip_id: TRIP_PUBLISHED,
      user_id: userRes.user!.id,
      pnr: "HACKED",
      payment_method: "cash",
      total_price: 50000,
      commission_rate: 0.25,
      idempotency_key: crypto.randomUUID(),
    });
    expect(error).not.toBeNull();
  });

  // T-SEC-2, the two tables the plan lists that were not yet covered.
  //
  // HOW "DENIED" LOOKS, and why these assertions are not symmetric.
  // INSERT raises: there is no INSERT privilege, so PostgREST returns an error.
  // UPDATE does NOT raise. With RLS on and no UPDATE policy, zero rows satisfy
  // the policy, so the statement updates nothing and PostgREST answers 200 with
  // an empty body — indistinguishable from a successful no-op at the error
  // level. Asserting `error !== null` on an UPDATE therefore tests nothing and
  // FAILS even though the data is perfectly safe. The real assertion is the
  // outcome: zero rows returned by `.select()`, and the row unchanged when read
  // back with the service role, which bypasses RLS and sees the truth.
  it("anonymous cannot INSERT seat_locks, and an UPDATE changes nothing", async () => {
    // seat_locks is the one that matters most: a caller who could write here
    // would hold seats without going through lock_seats, skipping the advisory
    // lock, the TTL and the conflict check — i.e. reserve a whole bus for free
    // and indefinitely.
    const client = await pooledAnonClient(21);
    const { data: userRes } = await client.auth.getUser();

    const insert = await client.from("seat_locks").insert({
      trip_id: TRIP_PUBLISHED,
      owner_id: userRes.user!.id,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(insert.error, "direct seat_locks INSERT must be denied").not.toBeNull();

    // Arrange a real row to aim at, so "zero rows affected" means the policy
    // stopped it rather than there being nothing there in the first place.
    const svc = serviceClient();
    const originalExpiry = new Date(Date.now() + 3_600_000).toISOString();
    await svc.from("seat_locks").delete().eq("id", SCRATCH_LOCK);
    await svc.from("seat_locks").insert({
      id: SCRATCH_LOCK,
      trip_id: TRIP_PUBLISHED,
      owner_id: userRes.user!.id, // the caller even OWNS it
      expires_at: originalExpiry,
    });

    try {
      const update = await client
        .from("seat_locks")
        .update({ expires_at: new Date(Date.now() + 86_400_000).toISOString() })
        .eq("id", SCRATCH_LOCK)
        .select();
      expect(update.data ?? [], "no row may be updated").toHaveLength(0);

      const { data: after } = await svc
        .from("seat_locks").select("expires_at").eq("id", SCRATCH_LOCK).single();
      expect(
        new Date(after!.expires_at).getTime(),
        "expires_at must be untouched — extending your own lock is exactly the abuse",
      ).toBe(new Date(originalExpiry).getTime());
    } finally {
      await svc.from("seat_locks").delete().eq("id", SCRATCH_LOCK);
    }
  });

  // companies is readable (approved ones are public catalog) but must never be
  // writable: status and commission_rate are admin-only money and visibility
  // controls. A successful UPDATE here would let anyone un-suspend themselves
  // or set their own commission to the 0.20 floor.
  it("anonymous cannot INSERT companies, and an UPDATE changes nothing", async () => {
    const client = await pooledAnonClient(21);
    const svc = serviceClient();

    const insert = await client.from("companies").insert({
      name: "شركة مزيفة",
      status: "approved",
      commission_rate: 0.2,
    });
    expect(insert.error, "direct companies INSERT must be denied").not.toBeNull();

    // Aim at an APPROVED company, i.e. a row this caller can actually SELECT —
    // otherwise "zero rows affected" would only prove the row was invisible,
    // not that writing it is refused.
    const before = await svc
      .from("companies").select("status,commission_rate").eq("id", COMPANY_APPROVED).single();

    const update = await client
      .from("companies")
      .update({ commission_rate: 0.2, status: "suspended" })
      .eq("id", COMPANY_APPROVED)
      .select();
    expect(update.data ?? [], "no company row may be updated").toHaveLength(0);

    const after = await svc
      .from("companies").select("status,commission_rate").eq("id", COMPANY_APPROVED).single();
    expect(after.data, "the company must be byte-identical afterwards").toEqual(before.data);

    // The pending company also stays hidden and unpromoted.
    const promote = await client
      .from("companies").update({ status: "approved" }).eq("id", COMPANY_PENDING).select();
    expect(promote.data ?? []).toHaveLength(0);
    const { data: stillPending } = await svc
      .from("companies").select("status").eq("id", COMPANY_PENDING).single();
    expect(stillPending!.status).toBe("pending");
  });
});
