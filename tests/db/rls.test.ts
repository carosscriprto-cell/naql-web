import { describe, it, expect } from "vitest";
import { pooledAnonClient, publicClient } from "./helpers";

// Seeded fixture ids (see supabase/seed.sql)
const TRIP_PUBLISHED = "000000e1-0000-4000-8000-000000000001"; // tomorrow, published
const TRIP_DEPARTED = "000000e1-0000-4000-8000-000000000013"; // published but in the past
const TRIP_DRAFT = "000000e1-0000-4000-8000-000000000015"; // draft
const COMPANY_PENDING = "000000a1-0000-4000-8000-000000000004"; // pending

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
});
