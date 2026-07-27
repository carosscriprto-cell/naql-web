import { describe, it, expect } from "vitest";
import { anonClient, pooledAnonClient, serviceClient } from "./helpers";

describe("smoke", () => {
  it("an anonymous passenger can open a session and gets an auth.uid()", async () => {
    // Must be a REAL fresh sign-in — this test's whole point is that
    // signInAnonymously() itself works. Not poolable.
    const client = await anonClient();
    const { data, error } = await client.auth.getUser();
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    expect(data.user?.is_anonymous).toBe(true);
  });

  it("app_config was seeded by the first migration", async () => {
    // Service role bypasses RLS (app_config is deny-by-default to clients).
    const svc = serviceClient();
    const { data, error } = await svc
      .from("app_config")
      .select("key,value")
      .order("key");

    expect(error).toBeNull();
    const config = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    expect(config.lock_ttl_minutes).toBe(10);
    expect(config.cancel_window_hours).toBe(2);
    expect(config.max_active_bookings_per_user).toBe(4);
    expect(config.max_active_bookings_per_phone_per_trip).toBe(4);
  });

  it("app_config is NOT readable by an unauthenticated/anon client (deny-by-default RLS)", async () => {
    const client = await pooledAnonClient(22); // pooled slot 22
    const { data } = await client.from("app_config").select("key");
    // RLS with no policy → zero rows (not an error), never the real config.
    expect(data ?? []).toHaveLength(0);
  });
});
