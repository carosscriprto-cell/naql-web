import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { pooledAnonClient, publicClient, serviceClient, type SupabaseClient } from "./helpers";

// A seeded published, future trip with 48 free seats and no bookings:
// n=9, القدموس, دمشق→اللاذقية (supabase/seed.sql). Not touched by catalog.test.
const TRIP = "000000e1-0000-4000-8000-000000000009";

const svc = serviceClient();

type Envelope = { ok: boolean; data?: any; error?: { code: string; details?: any } };
type SeatMap = { layout: any; seats: { number: string; status: string; gender?: string }[] };

function seat(map: SeatMap, number: string) {
  return map.seats.find((s) => s.number === number)!;
}

async function userId(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession(); // local read, no network
  return data.session!.user.id;
}

async function lockSeats(client: any, seats: { seatNumber: string; gender: string }[]) {
  const { data, error } = await client.rpc("lock_seats", {
    p_trip_id: TRIP,
    p_seats: seats,
  });
  expect(error, `lock_seats raised: ${error?.message}`).toBeNull();
  return data as Envelope;
}

async function getSeatMap(): Promise<SeatMap> {
  const { data, error } = await publicClient().rpc("get_seat_map", { p_trip_id: TRIP });
  expect(error, `get_seat_map raised: ${error?.message}`).toBeNull();
  const env = data as Envelope; // get_seat_map is enveloped (BACKEND_V1 §3)
  expect(env.ok, `get_seat_map not ok: ${JSON.stringify(env.error)}`).toBe(true);
  return env.data as SeatMap;
}

// Wipe every lock on the test trip so each case starts from 48 free seats and
// the trip is left clean for other suites.
async function wipeLocks() {
  await svc.from("seat_locks").delete().eq("trip_id", TRIP);
}

beforeAll(wipeLocks);
afterEach(wipeLocks);

describe("lock_seats concurrency (merge gate)", () => {
  it("10 parallel locks on the same seat → exactly 1 ok, 9 SEAT_ALREADY_LOCKED", async () => {
    // Pooled slots 0..9 — 10 distinct persistent users, reused across runs.
    const clients = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pooledAnonClient(i)),
    );

    // The merge gate depends on 10 DISTINCT identities — fail loudly otherwise.
    const ids = await Promise.all(clients.map(userId));
    expect(new Set(ids).size, `expected 10 distinct pooled users, got: ${ids.join(", ")}`).toBe(10);

    const results = await Promise.all(
      clients.map((c) => lockSeats(c, [{ seatNumber: "1", gender: "male" }])),
    );

    const ok = results.filter((r) => r.ok);
    const locked = results.filter((r) => !r.ok && r.error!.code === "SEAT_ALREADY_LOCKED");
    expect(ok).toHaveLength(1);
    expect(locked).toHaveLength(9);
  });

  it("overlapping [5,6] vs [6,7] → one ok, the other conflicts on exactly [6], zero partial rows", async () => {
    const [a, b] = await Promise.all([pooledAnonClient(10), pooledAnonClient(11)]);
    const [ra, rb] = await Promise.all([
      lockSeats(a, [
        { seatNumber: "5", gender: "male" },
        { seatNumber: "6", gender: "female" },
      ]),
      lockSeats(b, [
        { seatNumber: "6", gender: "male" },
        { seatNumber: "7", gender: "male" },
      ]),
    ]);

    const winners = [ra, rb].filter((r) => r.ok);
    const losers = [ra, rb].filter((r) => !r.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].error!.code).toBe("SEAT_ALREADY_LOCKED");
    expect(losers[0].error!.details.seats).toEqual(["6"]); // only the overlap

    const { data: rows } = await svc
      .from("seat_lock_seats")
      .select("seat_number")
      .eq("trip_id", TRIP);
    const held = new Set((rows ?? []).map((r) => r.seat_number));
    if (ra.ok) {
      // A won [5,6]; B's exclusive seat 7 must NOT be locked (no partial write).
      expect(held.has("5") && held.has("6")).toBe(true);
      expect(held.has("7")).toBe(false);
    } else {
      // B won [6,7]; A's exclusive seat 5 must NOT be locked.
      expect(held.has("6") && held.has("7")).toBe(true);
      expect(held.has("5")).toBe(false);
    }
  });

  it("an expired lock frees the seat with no cleanup job, and it is lockable again", async () => {
    const owner = await pooledAnonClient(10);
    const res = await lockSeats(owner, [{ seatNumber: "10", gender: "male" }]);
    expect(res.ok).toBe(true);
    expect(seat(await getSeatMap(), "10").status).toBe("locked");

    // Force expiry directly in the table — no background job runs.
    await svc
      .from("seat_locks")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", res.data.lockId);

    expect(seat(await getSeatMap(), "10").status).toBe("available");

    const relock = await lockSeats(await pooledAnonClient(11), [{ seatNumber: "10", gender: "female" }]);
    expect(relock.ok).toBe(true);
  });

  it("release: non-owner → FORBIDDEN (seat stays locked); owner → seat freed", async () => {
    const owner = await pooledAnonClient(10);
    const res = await lockSeats(owner, [{ seatNumber: "12", gender: "male" }]);
    const lockId = res.data.lockId;

    const stranger = await pooledAnonClient(11);
    const denied = (await stranger.rpc("release_lock", { p_lock_id: lockId })).data as Envelope;
    expect(denied.ok).toBe(false);
    expect(denied.error!.code).toBe("FORBIDDEN");
    expect(seat(await getSeatMap(), "12").status).toBe("locked");

    const freed = (await owner.rpc("release_lock", { p_lock_id: lockId })).data as Envelope;
    expect(freed.ok).toBe(true);
    expect(seat(await getSeatMap(), "12").status).toBe("available");
  });

  it("a gender declared in a lock is visible via get_seat_map from another session", async () => {
    await lockSeats(await pooledAnonClient(10), [{ seatNumber: "20", gender: "female" }]);

    const map = await getSeatMap(); // fresh public (different) session
    const s20 = seat(map, "20");
    expect(s20.status).toBe("locked");
    expect(s20.gender).toBe("female");

    // gender key is ABSENT (not null) on available seats.
    const free = map.seats.find((s) => s.status === "available")!;
    expect("gender" in free).toBe(false);
  });

  it("lock_seats with no session → UNAUTHORIZED, nothing locked", async () => {
    const res = (
      await publicClient().rpc("lock_seats", {
        p_trip_id: TRIP,
        p_seats: [{ seatNumber: "1", gender: "male" }],
      })
    ).data as Envelope;
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("UNAUTHORIZED");
  });

  it("a seat number not in the layout → VALIDATION_ERROR, nothing locked", async () => {
    const res = await lockSeats(await pooledAnonClient(10), [{ seatNumber: "999", gender: "male" }]);
    expect(res.ok).toBe(false);
    expect(res.error!.code).toBe("VALIDATION_ERROR");

    const { data: rows } = await svc
      .from("seat_lock_seats")
      .select("seat_number")
      .eq("trip_id", TRIP)
      .eq("seat_number", "999");
    expect(rows ?? []).toHaveLength(0);
  });
});
