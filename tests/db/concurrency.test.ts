import { describe, it, expect, afterAll, afterEach, beforeAll } from "vitest";
import {
  pooledAnonClient,
  publicClient,
  serviceClient,
  okData,
  type SupabaseClient,
  type Envelope,
  type SeatMap,
  type LockResponse,
} from "./helpers";

// A seeded published, future trip with 48 free seats and no bookings:
// n=9, القدموس, دمشق→اللاذقية (supabase/seed.sql). Not touched by catalog.test.
const TRIP = "000000e1-0000-4000-8000-000000000009";

const svc = serviceClient();

function seat(map: SeatMap, number: string) {
  return map.seats.find((s) => s.number === number)!;
}

async function userId(c: SupabaseClient): Promise<string> {
  const { data } = await c.auth.getSession(); // local read, no network
  return data.session!.user.id;
}

async function lockSeats(
  client: SupabaseClient,
  seats: { seatNumber: string; gender: string }[],
): Promise<Envelope<LockResponse>> {
  const { data, error } = await client.rpc("lock_seats", {
    p_trip_id: TRIP,
    p_seats: seats,
  });
  expect(error, `lock_seats raised: ${error?.message}`).toBeNull();
  return data as Envelope<LockResponse>;
}

async function getSeatMap(): Promise<SeatMap> {
  const { data, error } = await publicClient().rpc("get_seat_map", { p_trip_id: TRIP });
  expect(error, `get_seat_map raised: ${error?.message}`).toBeNull();
  const env = data as Envelope<SeatMap>; // get_seat_map is enveloped (BACKEND_V1 §3)
  if (!env.ok) throw new Error(`get_seat_map not ok: ${JSON.stringify(env.error)}`);
  return env.data;
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
    const locked = results.filter((r) => !r.ok && r.error.code === "SEAT_ALREADY_LOCKED");
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

    expect([ra, rb].filter((r) => r.ok)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    if (loser.ok) throw new Error("expected exactly one loser");
    expect(loser.error.code).toBe("SEAT_ALREADY_LOCKED");
    expect(loser.error.details?.seats).toEqual(["6"]); // only the overlap

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
    const { lockId } = okData(await lockSeats(owner, [{ seatNumber: "10", gender: "male" }]));
    expect(seat(await getSeatMap(), "10").status).toBe("locked");

    // Force expiry directly in the table — no background job runs.
    await svc
      .from("seat_locks")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", lockId);

    expect(seat(await getSeatMap(), "10").status).toBe("available");

    const relock = await lockSeats(await pooledAnonClient(11), [{ seatNumber: "10", gender: "female" }]);
    expect(relock.ok).toBe(true);
  });

  it("release: non-owner → FORBIDDEN (seat stays locked); owner → seat freed", async () => {
    const owner = await pooledAnonClient(10);
    const { lockId } = okData(await lockSeats(owner, [{ seatNumber: "12", gender: "male" }]));

    const stranger = await pooledAnonClient(11);
    const denied = (await stranger.rpc("release_lock", { p_lock_id: lockId }))
      .data as Envelope<null>;
    if (denied.ok) throw new Error("expected release_lock to be denied");
    expect(denied.error.code).toBe("FORBIDDEN");
    expect(seat(await getSeatMap(), "12").status).toBe("locked");

    const freed = (await owner.rpc("release_lock", { p_lock_id: lockId })).data as Envelope<null>;
    expect(freed.ok).toBe(true);
    expect(seat(await getSeatMap(), "12").status).toBe("available");
  });

  // T-LOCK-5, third case — previously unasserted (docs/STATE_REPORT.md §7).
  it("release_lock on an already-gone lock is ok (idempotent)", async () => {
    const owner = await pooledAnonClient(10);
    const { lockId } = okData(await lockSeats(owner, [{ seatNumber: "14", gender: "male" }]));

    const first = (await owner.rpc("release_lock", { p_lock_id: lockId })).data as Envelope<null>;
    expect(first.ok).toBe(true);

    // Releasing the same lock again must NOT be FORBIDDEN or NOT_FOUND. The
    // frontend fires a best-effort release on unload and again on the countdown
    // hitting zero, so the second call is a normal event, not an error — and the
    // caller is no longer the owner of anything, so a naive ownership check
    // would answer FORBIDDEN here.
    const second = (await owner.rpc("release_lock", { p_lock_id: lockId })).data as Envelope<null>;
    expect(second.ok, "a repeated release must stay ok").toBe(true);

    // A lock id that never existed is equally ok — same reasoning.
    const never = (await owner.rpc("release_lock", {
      p_lock_id: "000000ee-0000-4000-8000-00000000dead",
    })).data as Envelope<null>;
    expect(never.ok).toBe(true);

    expect(seat(await getSeatMap(), "14").status).toBe("available");
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
    ).data as Envelope<LockResponse>;
    if (res.ok) throw new Error("expected UNAUTHORIZED");
    expect(res.error.code).toBe("UNAUTHORIZED");
  });

  it("a seat number not in the layout → VALIDATION_ERROR, nothing locked", async () => {
    const res = await lockSeats(await pooledAnonClient(10), [{ seatNumber: "999", gender: "male" }]);
    if (res.ok) throw new Error("expected VALIDATION_ERROR");
    expect(res.error.code).toBe("VALIDATION_ERROR");

    const { data: rows } = await svc
      .from("seat_lock_seats")
      .select("seat_number")
      .eq("trip_id", TRIP)
      .eq("seat_number", "999");
    expect(rows ?? []).toHaveLength(0);
  });
});

// ===========================================================================
// T-LOCK-3 (P0 [AUTO]) — lock_seats against an already-BOOKED seat.
//
// Until now nothing executed the booked-conflict branch of lock_seats
// (20260726135700_seat_map_and_locking.sql §f, the SEAT_ALREADY_BOOKED return).
// Every existing case in this file exercises the LOCKED branch below it, and
// booking.test.ts hits SEAT_ALREADY_BOOKED from create_booking's partial unique
// index — a different code path in a different function.
//
// Fixture: one booking + one active booking_passengers row on a scratch seat of
// the same seeded trip, under a reserved uuid prefix, torn down in afterAll.
// Seats 40/41 are used by nothing else in this file (the cases above use
// 1, 5, 6, 7, 10, 12, 20), and seeded trip n=9 carries no bookings.
//
// A crashed run leaves a greppable orphan, hand-cleanable with:
//   delete from bookings where id = '000000ee-0000-4000-8000-0000b00c0001';
//   -- booking_passengers cascades
// ===========================================================================
const BOOKED_SEAT = "40";
const FREE_SEAT = "41";
const SCRATCH_BOOKING = "000000ee-0000-4000-8000-0000b00c0001";
const SCRATCH_IDEMPOTENCY = "000000ee-0000-4000-8000-0000b00c0002";
const DEMO_PASSENGER = "000000db-0000-4000-8000-000000000001"; // seeded auth.users row

async function dropBookingFixture() {
  // booking_passengers is ON DELETE CASCADE from bookings; deleted explicitly
  // first so a partially-created fixture also cleans up.
  await svc.from("booking_passengers").delete().eq("booking_id", SCRATCH_BOOKING);
  await svc.from("bookings").delete().eq("id", SCRATCH_BOOKING);
}

describe("lock_seats vs a booked seat (T-LOCK-3)", () => {
  beforeAll(async () => {
    await dropBookingFixture(); // a previous crashed run may have left it behind

    const booking = await svc.from("bookings").insert({
      id: SCRATCH_BOOKING,
      trip_id: TRIP,
      user_id: DEMO_PASSENGER,
      pnr: "SCRTCH",
      status: "confirmed",
      payment_method: "cash",
      total_price: 100000,
      commission_rate: 0.25,
      idempotency_key: SCRATCH_IDEMPOTENCY,
    });
    if (booking.error) throw new Error(`arrange booking: ${booking.error.message}`);

    // active = true is what the partial unique index and every availability
    // count key on — a cancelled (active=false) row would free the seat.
    const passenger = await svc.from("booking_passengers").insert({
      booking_id: SCRATCH_BOOKING,
      trip_id: TRIP,
      seat_number: BOOKED_SEAT,
      full_name: "راكب اختبار",
      phone: "+963900000040",
      gender: "male",
      active: true,
    });
    if (passenger.error) throw new Error(`arrange passenger: ${passenger.error.message}`);
  });

  afterAll(dropBookingFixture); // runs even if the assertions failed

  it("the seat really is booked on the public map", async () => {
    // Guards the fixture itself: if this is not "booked", the two cases below
    // would pass for the wrong reason (a free seat conflicting on nothing).
    expect(seat(await getSeatMap(), BOOKED_SEAT).status).toBe("booked");
  });

  it("locking it → SEAT_ALREADY_BOOKED with details.seats = exactly that seat", async () => {
    const res = await lockSeats(await pooledAnonClient(10), [
      { seatNumber: BOOKED_SEAT, gender: "male" },
    ]);

    if (res.ok) throw new Error("expected SEAT_ALREADY_BOOKED");
    // NOT SEAT_ALREADY_LOCKED — booked and locked are different states with
    // different recovery UX, and the booked check runs first (§3).
    expect(res.error.code).toBe("SEAT_ALREADY_BOOKED");
    expect(res.error.details?.seats).toEqual([BOOKED_SEAT]);
  });

  // T-PAS4-8 — previously only half-covered (docs/STATE_REPORT.md §7): gender on
  // locked and gender on booked were asserted in separate tests, and nothing
  // asserted its ABSENCE on available. One call, all three statuses, because
  // the frontend renders them from a single response and the gender key drives
  // which icon each seat gets.
  it("ONE get_seat_map shows all three statuses, gender only on locked+booked", async () => {
    // seat 40 is booked by this describe's fixture (male); lock 41 as female so
    // the two occupied states carry DIFFERENT genders and cannot be confused.
    const res = await lockSeats(await pooledAnonClient(10), [
      { seatNumber: FREE_SEAT, gender: "female" },
    ]);
    expect(res.ok, "arrange: locking the free seat should succeed").toBe(true);

    const map = await getSeatMap();

    const booked = seat(map, BOOKED_SEAT);
    expect(booked.status).toBe("booked");
    expect(booked.gender).toBe("male");

    const locked = seat(map, FREE_SEAT);
    expect(locked.status).toBe("locked");
    expect(locked.gender).toBe("female");

    // Available seats carry NO gender key at all — absent, not null. The
    // frontend checks `"gender" in seat`, so a null would render a gender icon
    // on an empty seat.
    const available = map.seats.find((s) => s.status === "available")!;
    expect(available, "the bus cannot be entirely occupied here").toBeDefined();
    expect("gender" in available).toBe(false);

    // All three states really are present in this one response.
    expect(new Set(map.seats.map((s) => s.status))).toEqual(
      new Set(["available", "locked", "booked"]),
    );
  });

  it("a booked seat mixed with a free one locks NOTHING (all-or-nothing)", async () => {
    const res = await lockSeats(await pooledAnonClient(11), [
      { seatNumber: FREE_SEAT, gender: "female" },
      { seatNumber: BOOKED_SEAT, gender: "male" },
    ]);

    if (res.ok) throw new Error("expected SEAT_ALREADY_BOOKED");
    expect(res.error.code).toBe("SEAT_ALREADY_BOOKED");
    // Only the booked seat is reported, not the whole request.
    expect(res.error.details?.seats).toEqual([BOOKED_SEAT]);

    // The free seat must NOT have been locked on the way to the failure.
    const { data: rows } = await svc
      .from("seat_lock_seats")
      .select("seat_number")
      .eq("trip_id", TRIP);
    expect((rows ?? []).map((r) => r.seat_number)).not.toContain(FREE_SEAT);
    expect(seat(await getSeatMap(), FREE_SEAT).status).toBe("available");
  });
});
