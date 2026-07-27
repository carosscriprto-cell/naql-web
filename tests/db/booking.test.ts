import { describe, it, expect, beforeAll, afterEach } from "vitest";
import {
  pooledAnonClient,
  publicClient,
  serviceClient,
  okData,
  type SupabaseClient,
  type Envelope,
  type Gender,
  type SeatMap,
  type LockResponse,
  type TripItem,
} from "./helpers";

// ===========================================================================
// B4 / M4 — create_booking, cancel_booking, lookup_booking, get_booking.
// Reference: docs/BACKEND_V1.md §4 + the POST /api/bookings MSW handler.
//
// Seed fixtures (supabase/seed.sql):
//   TRIP   n=10 — الأهلية دمشق→اللاذقية, tomorrow, 48 seats, price 80 000,
//                 commission 0.200, no seeded bookings. Untouched by the other
//                 suites (catalog uses n=1, concurrency uses n=9).
// Pooled anon slots 30..39 are reserved for this file (concurrency uses 0..11,
// rls uses 20..21).
// ===========================================================================
const TRIP = "000000e1-0000-4000-8000-000000000010";
const AHLIA = "000000a1-0000-4000-8000-000000000003";
const AHLIA_BUS = "000000b1-0000-4000-8000-000000000032";
const LATAKIA_ROUTE = "000000e2-0000-4000-8000-000000000003";
const TRIP_PRICE = 80_000;

const svc = serviceClient();

type BookingPassenger = {
  seatNumber: string;
  fullName: string;
  phone: string;
  gender: Gender;
};

type Ticket = {
  id: string;
  pnr: string;
  status: "confirmed" | "cancelled";
  qrPayload: string;
  trip: TripItem;
  passengers: BookingPassenger[];
  totalPrice: number;
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
let phoneSeq = 10_000_000;
/** A fresh, valid Syrian mobile number: ^\+9639\d{8}$ */
function phone(): string {
  return `+9639${(phoneSeq++).toString().padStart(8, "0")}`;
}

function passenger(
  seatNumber: string,
  gender: Gender = "male",
  overrides: Partial<BookingPassenger> = {},
): BookingPassenger {
  return {
    seatNumber,
    fullName: `راكب ${seatNumber}`,
    phone: phone(),
    gender,
    ...overrides,
  };
}

async function lockSeats(
  client: SupabaseClient,
  seats: { seatNumber: string; gender: Gender }[],
  tripId = TRIP,
): Promise<LockResponse> {
  const { data, error } = await client.rpc("lock_seats", {
    p_trip_id: tripId,
    p_seats: seats,
  });
  expect(error, `lock_seats raised: ${error?.message}`).toBeNull();
  return okData(data as Envelope<LockResponse>);
}

/** Lock the given seats (gender taken from the passengers) and book them. */
async function book(
  client: SupabaseClient,
  passengers: BookingPassenger[],
  opts: { key?: string; paymentMethod?: string; tripId?: string } = {},
): Promise<Envelope<Ticket>> {
  const { lockId } = await lockSeats(
    client,
    passengers.map((p) => ({ seatNumber: p.seatNumber, gender: p.gender })),
    opts.tripId ?? TRIP,
  );
  return createBooking(client, {
    lockId,
    key: opts.key ?? crypto.randomUUID(),
    paymentMethod: opts.paymentMethod,
    passengers,
  });
}

async function createBooking(
  client: SupabaseClient,
  args: {
    lockId: string;
    key: string;
    passengers: BookingPassenger[];
    paymentMethod?: string;
  },
): Promise<Envelope<Ticket>> {
  const { data, error } = await client.rpc("create_booking", {
    p_lock_id: args.lockId,
    p_idempotency_key: args.key,
    p_payment_method: args.paymentMethod ?? "cash",
    p_passengers: args.passengers,
  });
  expect(error, `create_booking raised: ${error?.message}`).toBeNull();
  return data as Envelope<Ticket>;
}

async function seatMap(tripId = TRIP): Promise<SeatMap> {
  const { data, error } = await publicClient().rpc("get_seat_map", {
    p_trip_id: tripId,
  });
  expect(error, `get_seat_map raised: ${error?.message}`).toBeNull();
  return okData(data as Envelope<SeatMap>);
}

function seat(map: SeatMap, number: string) {
  return map.seats.find((s) => s.number === number)!;
}

/** Remove every booking + lock this suite could have left on a trip. */
async function wipe(tripId = TRIP) {
  await svc.from("bookings").delete().eq("trip_id", tripId); // cascades passengers
  await svc.from("seat_locks").delete().eq("trip_id", tripId);
}

async function bookingRows(tripId = TRIP) {
  const { data, error } = await svc
    .from("bookings")
    .select("id,pnr,status,total_price,commission_rate,idempotency_key,created_at")
    .eq("trip_id", tripId);
  expect(error, `bookings read: ${error?.message}`).toBeNull();
  return data ?? [];
}

async function passengerRows(tripId = TRIP) {
  const { data, error } = await svc
    .from("booking_passengers")
    .select("seat_number,active,phone,gender")
    .eq("trip_id", tripId);
  expect(error, `booking_passengers read: ${error?.message}`).toBeNull();
  return data ?? [];
}

function expectError(env: Envelope<unknown>, code: string) {
  if (env.ok) throw new Error(`expected ${code}, got ok: ${JSON.stringify(env)}`);
  expect(env.error.code).toBe(code);
  return env.error;
}

beforeAll(() => wipe());
afterEach(() => wipe());

// ===========================================================================
// Idempotency — the merge gate
// ===========================================================================
describe("create_booking — idempotency", () => {
  it("MERGE GATE: two parallel identical calls → exactly ONE booking, identical bodies", async () => {
    const client = await pooledAnonClient(30);
    const { lockId } = await lockSeats(client, [
      { seatNumber: "1", gender: "male" },
      { seatNumber: "2", gender: "female" },
    ]);
    const key = crypto.randomUUID();
    const passengers = [
      passenger("1", "male"),
      passenger("2", "female"),
    ];

    // Real parallelism — no mocks, no staggering.
    const [a, b] = await Promise.all([
      createBooking(client, { lockId, key, passengers }),
      createBooking(client, { lockId, key, passengers }),
    ]);

    expect(a.ok, `first call failed: ${JSON.stringify(a)}`).toBe(true);
    expect(b.ok, `second call failed: ${JSON.stringify(b)}`).toBe(true);
    // Byte-identical bodies: one is the freshly built ticket, the other is the
    // stored response_snapshot replayed verbatim.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));

    const rows = await bookingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].idempotency_key).toBe(key);
    expect(await passengerRows()).toHaveLength(2);
  });

  it("replays the stored response on a sequential retry (never a second row)", async () => {
    const client = await pooledAnonClient(30);
    const { lockId } = await lockSeats(client, [{ seatNumber: "5", gender: "male" }]);
    const key = crypto.randomUUID();
    const passengers = [passenger("5", "male")];

    const first = await createBooking(client, { lockId, key, passengers });
    // The lock is consumed by now — the retry must still replay, not LOCK_EXPIRED.
    const retry = await createBooking(client, { lockId, key, passengers });

    expect(JSON.stringify(retry)).toBe(JSON.stringify(first));
    expect(await bookingRows()).toHaveLength(1);
  });

  it("same key + different payload → IDEMPOTENCY_CONFLICT", async () => {
    const client = await pooledAnonClient(30);
    const { lockId } = await lockSeats(client, [{ seatNumber: "6", gender: "male" }]);
    const key = crypto.randomUUID();

    const first = await createBooking(client, {
      lockId,
      key,
      passengers: [passenger("6", "male", { fullName: "أحمد علي" })],
    });
    expect(first.ok).toBe(true);

    const conflict = await createBooking(client, {
      lockId,
      key,
      passengers: [passenger("6", "male", { fullName: "سمير حسن" })],
    });
    expectError(conflict, "IDEMPOTENCY_CONFLICT");
    expect(await bookingRows()).toHaveLength(1);
  });
});

// ===========================================================================
// Seat safety — the partial unique index is the last line of defence
// ===========================================================================
describe("create_booking — double-booking is impossible", () => {
  it("two parallel calls, different keys, same held seats → one booking, zero partial rows", async () => {
    const client = await pooledAnonClient(31);
    const { lockId } = await lockSeats(client, [
      { seatNumber: "10", gender: "male" },
      { seatNumber: "11", gender: "male" },
    ]);
    const passengers = [passenger("10", "male"), passenger("11", "male")];

    const [a, b] = await Promise.all([
      createBooking(client, { lockId, key: crypto.randomUUID(), passengers }),
      createBooking(client, { lockId, key: crypto.randomUUID(), passengers }),
    ]);

    const winners = [a, b].filter((r) => r.ok);
    expect(winners).toHaveLength(1);

    const loser = (a.ok ? b : a) as Extract<Envelope<Ticket>, { ok: false }>;
    // EXACTLY TWO legal interleavings, both correct under §4:
    //   - the loser read the lock BEFORE the winner committed → it reaches the
    //     insert and the partial unique index rejects it → SEAT_ALREADY_BOOKED;
    //   - the loser read the lock AFTER the winner committed → the lock was
    //     already consumed → LOCK_EXPIRED.
    // The deterministic SEAT_ALREADY_BOOKED mapping is asserted in the next test.
    //
    // VALIDATION_ERROR is NOT a third outcome. It used to be: step (b) read the
    // lock row and step (d) re-read its seats, two statements and therefore two
    // READ COMMITTED snapshots, so the winner's `delete from seat_locks` could
    // land between them and leave the loser holding a live lock with no seats —
    // which fell through to the passenger-coverage check and blamed the caller's
    // (perfectly valid) passenger data for a lost race. That distinction is not
    // cosmetic: the frontend renders VALIDATION_ERROR as a checkout form-field
    // error, while LOCK_EXPIRED opens the expiry dialog and returns the
    // passenger to the seat map — the only outcome that offers a way forward.
    // 20260727130000_create_booking_lock_single_snapshot.sql reads the lock and
    // its seats in ONE statement, so the empty-seat-set state is unobservable.
    expect(["SEAT_ALREADY_BOOKED", "LOCK_EXPIRED"]).toContain(loser.error.code);

    expect(await bookingRows()).toHaveLength(1);
    const rows = await passengerRows();
    expect(rows).toHaveLength(2); // exactly the winner's seats — no partial rows
    expect(rows.map((r) => r.seat_number).sort()).toEqual(["10", "11"]);
  });

  it("a seat booked out of band → SEAT_ALREADY_BOOKED, nothing created", async () => {
    const client = await pooledAnonClient(31);
    const { lockId } = await lockSeats(client, [
      { seatNumber: "20", gender: "male" },
      { seatNumber: "21", gender: "male" },
    ]);

    // Someone else's active passenger row lands on seat 21 after the lock was
    // taken (only reachable with the service role — the lock makes it impossible
    // through the API, which is exactly why the index exists).
    const { data: other, error: bErr } = await svc
      .from("bookings")
      .insert({
        trip_id: TRIP,
        user_id: "000000db-0000-4000-8000-000000000001",
        pnr: "OOBAND",
        payment_method: "cash",
        total_price: TRIP_PRICE,
        commission_rate: 0.2,
        idempotency_key: crypto.randomUUID(),
      })
      .select("id")
      .single();
    expect(bErr, `arrange booking: ${bErr?.message}`).toBeNull();
    const { error: pErr } = await svc.from("booking_passengers").insert({
      booking_id: other!.id,
      trip_id: TRIP,
      seat_number: "21",
      full_name: "راكب خارجي",
      phone: phone(),
      gender: "male",
      active: true,
    });
    expect(pErr, `arrange passenger: ${pErr?.message}`).toBeNull();

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("20", "male"), passenger("21", "male")],
    });
    expectError(res, "SEAT_ALREADY_BOOKED");

    // The whole insert rolled back: no orphan booking row, no seat 20 passenger.
    expect(await bookingRows()).toHaveLength(1); // only the out-of-band one
    const rows = await passengerRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].seat_number).toBe("21");
  });
});

// ===========================================================================
// Lock validation — one code for every failure mode
// ===========================================================================
describe("create_booking — lock validation", () => {
  it("an EXPIRED lock → LOCK_EXPIRED", async () => {
    const client = await pooledAnonClient(32);
    const { lockId } = await lockSeats(client, [{ seatNumber: "3", gender: "male" }]);
    await svc
      .from("seat_locks")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", lockId);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("3", "male")],
    });
    expectError(res, "LOCK_EXPIRED");
    expect(await bookingRows()).toHaveLength(0);
  });

  it("a MISSING lock → LOCK_EXPIRED", async () => {
    const client = await pooledAnonClient(32);
    const res = await createBooking(client, {
      lockId: crypto.randomUUID(),
      key: crypto.randomUUID(),
      passengers: [passenger("3", "male")],
    });
    expectError(res, "LOCK_EXPIRED");
  });

  it("ANOTHER USER'S lock → LOCK_EXPIRED, never FORBIDDEN (no existence disclosure)", async () => {
    const owner = await pooledAnonClient(32);
    const stranger = await pooledAnonClient(33);
    const { lockId } = await lockSeats(owner, [{ seatNumber: "4", gender: "male" }]);

    const res = await createBooking(stranger, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("4", "male")],
    });
    // release_lock DOES return FORBIDDEN here (see concurrency.test.ts) — that
    // asymmetry is the contract (§4), not an oversight.
    expectError(res, "LOCK_EXPIRED");
    expect(await bookingRows()).toHaveLength(0);
  });
});

// ===========================================================================
// Passenger validation
// ===========================================================================
describe("create_booking — passenger validation", () => {
  it("gender that disagrees with the lock → VALIDATION_ERROR on passenger.{seat}.gender", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [{ seatNumber: "7", gender: "female" }]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("7", "male")],
    });
    const error = expectError(res, "VALIDATION_ERROR");
    expect(error.details?.field).toBe("passenger.7.gender");
    expect(await bookingRows()).toHaveLength(0);
  });

  it("a MISSING seat → VALIDATION_ERROR on passengers", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [
      { seatNumber: "8", gender: "male" },
      { seatNumber: "9", gender: "male" },
    ]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("8", "male")],
    });
    expect(expectError(res, "VALIDATION_ERROR").details?.field).toBe("passengers");
  });

  it("an EXTRA seat → VALIDATION_ERROR on passengers", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [{ seatNumber: "12", gender: "male" }]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("12", "male"), passenger("13", "male")],
    });
    expect(expectError(res, "VALIDATION_ERROR").details?.field).toBe("passengers");
  });

  it("a DUPLICATED seat → VALIDATION_ERROR on passengers", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [
      { seatNumber: "14", gender: "male" },
      { seatNumber: "15", gender: "male" },
    ]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("14", "male"), passenger("14", "male")],
    });
    expect(expectError(res, "VALIDATION_ERROR").details?.field).toBe("passengers");
  });

  it("a badly formatted phone → VALIDATION_ERROR on passenger.{seat}.phone", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [{ seatNumber: "16", gender: "male" }]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("16", "male", { phone: "0955123456" })],
    });
    expect(expectError(res, "VALIDATION_ERROR").details?.field).toBe(
      "passenger.16.phone",
    );
    expect(await bookingRows()).toHaveLength(0);
  });

  it("a blank name → VALIDATION_ERROR on passenger.{seat}.fullName", async () => {
    const client = await pooledAnonClient(34);
    const { lockId } = await lockSeats(client, [{ seatNumber: "17", gender: "male" }]);

    const res = await createBooking(client, {
      lockId,
      key: crypto.randomUUID(),
      passengers: [passenger("17", "male", { fullName: "  " })],
    });
    expect(expectError(res, "VALIDATION_ERROR").details?.field).toBe(
      "passenger.17.fullName",
    );
  });
});

// ===========================================================================
// Response shape + seat map + commission snapshot
// ===========================================================================
describe("create_booking — response and side effects", () => {
  it("returns the §4 ticket with the FULL §2 trip shape and a signed qrPayload", async () => {
    const client = await pooledAnonClient(35);
    const pax = [passenger("30", "female"), passenger("31", "male")];
    const ticket = okData(await book(client, pax));

    expect(ticket.status).toBe("confirmed");
    expect(ticket.pnr).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(ticket.totalPrice).toBe(TRIP_PRICE * 2);

    // qrPayload = {bookingId}.{hex HMAC-SHA256}
    const [bookingId, mac] = ticket.qrPayload.split(".");
    expect(bookingId).toBe(ticket.id);
    expect(mac).toMatch(/^[0-9a-f]{64}$/);

    // trip = the full §2 search-item shape (bookingSchema reuses tripSearchItemSchema).
    expect(ticket.trip.id).toBe(TRIP);
    expect(ticket.trip.currency).toBe("SYP");
    expect(typeof ticket.trip.availableSeats).toBe("number");
    expect(["عادي", "VIP"]).toContain(ticket.trip.busType);
    expect(ticket.trip.company).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      logoUrl: expect.any(String),
      rating: expect.any(Number),
    });
    expect(ticket.trip.fromCity).toMatchObject({ nameAr: "دمشق" });
    expect(ticket.trip.toCity).toMatchObject({ nameAr: "اللاذقية" });
    expect(ticket.trip.departureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    expect(ticket.passengers.map((p) => p.seatNumber)).toEqual(["30", "31"]);
    expect(ticket.passengers[0]).toMatchObject({
      seatNumber: "30",
      gender: "female",
      phone: pax[0].phone,
    });
  });

  it("booked seats show as booked WITH gender on the map, and the lock is gone", async () => {
    const client = await pooledAnonClient(35);
    const ticket = okData(
      await book(client, [passenger("40", "female"), passenger("41", "male")]),
    );

    const map = await seatMap();
    expect(seat(map, "40")).toMatchObject({ status: "booked", gender: "female" });
    expect(seat(map, "41")).toMatchObject({ status: "booked", gender: "male" });

    const { data: locks } = await svc
      .from("seat_locks")
      .select("id")
      .eq("trip_id", TRIP);
    expect(locks ?? []).toHaveLength(0);
    expect(ticket.id).toBeTruthy();
  });

  it("commission_rate is snapshotted — a later company rate change moves nothing", async () => {
    const client = await pooledAnonClient(35);
    const ticket = okData(await book(client, [passenger("33", "male")]));

    const before = (await bookingRows())[0];
    expect(Number(before.commission_rate)).toBeCloseTo(0.2, 3);
    expect(before.total_price).toBe(TRIP_PRICE);

    await svc.from("companies").update({ commission_rate: 0.35 }).eq("id", AHLIA);
    try {
      const after = (await bookingRows())[0];
      expect(Number(after.commission_rate)).toBeCloseTo(0.2, 3);
      expect(after.total_price).toBe(TRIP_PRICE);
      expect(after.id).toBe(ticket.id);
    } finally {
      await svc.from("companies").update({ commission_rate: 0.2 }).eq("id", AHLIA);
    }
  });
});

// ===========================================================================
// Booking limits (app_config, never literals)
// ===========================================================================
describe("create_booking — booking limits", () => {
  async function configInt(key: string): Promise<number> {
    const { data, error } = await svc
      .from("app_config")
      .select("value")
      .eq("key", key)
      .single();
    expect(error, `app_config ${key}: ${error?.message}`).toBeNull();
    return Number(data!.value);
  }

  it("exceeding max_active_bookings_per_user → BOOKING_LIMIT_REACHED, nothing created", async () => {
    const max = await configInt("max_active_bookings_per_user");
    const client = await pooledAnonClient(36);

    // Distinct phones so the per-phone ceiling cannot fire first.
    for (let i = 0; i < max; i++) {
      const res = await book(client, [passenger(String(i + 1), "male")]);
      expect(res.ok, `booking ${i + 1} failed: ${JSON.stringify(res)}`).toBe(true);
    }
    expect(await bookingRows()).toHaveLength(max);

    const over = await book(client, [passenger(String(max + 1), "male")]);
    expectError(over, "BOOKING_LIMIT_REACHED");
    expect(await bookingRows()).toHaveLength(max); // nothing created
    expect(await passengerRows()).toHaveLength(max);
  });

  it("exceeding max_active_bookings_per_phone_per_trip → BOOKING_LIMIT_REACHED", async () => {
    const max = await configInt("max_active_bookings_per_phone_per_trip");
    const client = await pooledAnonClient(37);
    const shared = phone();

    // One booking that fills the phone's quota exactly (still under the per-user
    // ceiling, which counts BOOKINGS not passengers).
    const filled = await book(
      client,
      Array.from({ length: max }, (_, i) =>
        passenger(String(i + 1), "male", { phone: shared }),
      ),
    );
    expect(filled.ok, `quota-filling booking failed: ${JSON.stringify(filled)}`).toBe(
      true,
    );

    const over = await book(client, [
      passenger(String(max + 1), "male", { phone: shared }),
    ]);
    expectError(over, "BOOKING_LIMIT_REACHED");

    expect(await bookingRows()).toHaveLength(1);
    expect(await passengerRows()).toHaveLength(max);
  });
});

// ===========================================================================
// PNR generation
// ===========================================================================
describe("PNR", () => {
  it("200 generated PNRs: 6 chars, never 0 O 1 I, all unique", async () => {
    const pnrs: string[] = [];
    for (let batch = 0; batch < 10; batch++) {
      const round = await Promise.all(
        Array.from({ length: 20 }, async () => {
          const { data, error } = await svc.rpc("generate_pnr");
          expect(error, `generate_pnr raised: ${error?.message}`).toBeNull();
          return data as string;
        }),
      );
      pnrs.push(...round);
    }

    expect(pnrs).toHaveLength(200);
    for (const pnr of pnrs) {
      expect(pnr).toHaveLength(6);
      expect(pnr).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(pnr).not.toMatch(/[0O1I]/);
    }
    // 32^6 ≈ 1.07e9 — a collision in 200 draws would mean the generator is broken.
    expect(new Set(pnrs).size).toBe(200);
  });
});

// ===========================================================================
// cancel_booking
// ===========================================================================
describe("cancel_booking", () => {
  it("frees the seats (active=false) and the map shows them available again", async () => {
    const client = await pooledAnonClient(38);
    const ticket = okData(await book(client, [passenger("44", "female")]));
    expect(seat(await seatMap(), "44")).toMatchObject({
      status: "booked",
      gender: "female",
    });

    const { data, error } = await client.rpc("cancel_booking", {
      p_booking_id: ticket.id,
    });
    expect(error, `cancel_booking raised: ${error?.message}`).toBeNull();
    const cancelled = okData(data as Envelope<Ticket>);
    expect(cancelled.status).toBe("cancelled");

    expect(seat(await seatMap(), "44").status).toBe("available");
    expect((await passengerRows()).every((r) => r.active === false)).toBe(true);

    // The freed seat is immediately lockable again.
    const relock = await lockSeats(await pooledAnonClient(39), [
      { seatNumber: "44", gender: "male" },
    ]);
    expect(relock.lockId).toBeTruthy();
  });

  it("inside the cancel window → CANCEL_WINDOW_CLOSED, booking untouched", async () => {
    const client = await pooledAnonClient(38);
    const ticket = okData(await book(client, [passenger("45", "male")]));

    const { data: cfg } = await svc
      .from("app_config")
      .select("value")
      .eq("key", "cancel_window_hours")
      .single();
    const hours = Number(cfg!.value);

    const { data: trip } = await svc
      .from("trips")
      .select("departure_at")
      .eq("id", TRIP)
      .single();
    const original = trip!.departure_at;

    // Slide departure to just inside the window (service role — no RPC does this).
    await svc
      .from("trips")
      .update({
        departure_at: new Date(Date.now() + (hours * 60 - 5) * 60_000).toISOString(),
      })
      .eq("id", TRIP);

    try {
      const { data } = await client.rpc("cancel_booking", { p_booking_id: ticket.id });
      expectError(data as Envelope<Ticket>, "CANCEL_WINDOW_CLOSED");
      const rows = await bookingRows();
      expect(rows[0].status).toBe("confirmed");
      expect((await passengerRows()).every((r) => r.active === true)).toBe(true);
    } finally {
      await svc.from("trips").update({ departure_at: original }).eq("id", TRIP);
    }
  });

  it("a non-owner can never cancel (NOT_FOUND, and the booking survives)", async () => {
    const owner = await pooledAnonClient(38);
    const stranger = await pooledAnonClient(39);
    const ticket = okData(await book(owner, [passenger("46", "male")]));

    const { data } = await stranger.rpc("cancel_booking", { p_booking_id: ticket.id });
    // NOT_FOUND, not FORBIDDEN: booking ids must not be probeable for existence.
    expectError(data as Envelope<Ticket>, "NOT_FOUND");

    const rows = await bookingRows();
    expect(rows[0].status).toBe("confirmed");
    expect(seat(await seatMap(), "46").status).toBe("booked");
  });
});

// ===========================================================================
// get_booking + bookings-mine (PostgREST + RLS, no RPC)
// ===========================================================================
describe("get_booking and bookings-mine", () => {
  it("get_booking: owner gets the ticket, anyone else gets NOT_FOUND", async () => {
    const owner = await pooledAnonClient(38);
    const stranger = await pooledAnonClient(39);
    const ticket = okData(await book(owner, [passenger("47", "male")]));

    const mine = okData(
      (await owner.rpc("get_booking", { p_id: ticket.id })).data as Envelope<Ticket>,
    );
    expect(mine.id).toBe(ticket.id);
    expect(mine.qrPayload).toBe(ticket.qrPayload); // deterministic HMAC

    const theirs = (await stranger.rpc("get_booking", { p_id: ticket.id }))
      .data as Envelope<Ticket>;
    expectError(theirs, "NOT_FOUND");

    const missing = (await owner.rpc("get_booking", { p_id: crypto.randomUUID() }))
      .data as Envelope<Ticket>;
    expectError(missing, "NOT_FOUND");
  });

  it("bookings-mine: RLS owner-only, newest first, paginated", async () => {
    const owner = await pooledAnonClient(38);
    const stranger = await pooledAnonClient(39);

    const first = okData(await book(owner, [passenger("36", "male")]));
    const second = okData(await book(owner, [passenger("37", "male")]));

    // The frontend reads this through PostgREST + bookings_owner_read — no RPC.
    const { data: mine, error } = await owner
      .from("bookings")
      .select("id,created_at")
      .order("created_at", { ascending: false });
    expect(error, `bookings-mine: ${error?.message}`).toBeNull();
    expect(mine!.map((b) => b.id)).toEqual([second.id, first.id]); // newest first

    // Pagination: one page of one row.
    const { data: page } = await owner
      .from("bookings")
      .select("id")
      .order("created_at", { ascending: false })
      .range(0, 0);
    expect(page).toHaveLength(1);
    expect(page![0].id).toBe(second.id);

    const { data: others } = await stranger.from("bookings").select("id");
    expect(others).toHaveLength(0);
  });
});

// ===========================================================================
// lookup_booking — the unauthenticated enumeration surface
// ===========================================================================
describe("lookup_booking", () => {
  async function lookup(pnr: string, phoneNumber: string) {
    const { data, error } = await publicClient().rpc("lookup_booking", {
      p_pnr: pnr,
      p_phone: phoneNumber,
    });
    expect(error, `lookup_booking raised: ${error?.message}`).toBeNull();
    return data as Envelope<Ticket>;
  }

  async function clearAttempts(pnr: string) {
    await svc.from("lookup_attempts").delete().eq("pnr", pnr);
  }

  it("the correct (pnr, phone) pair returns the full ticket, case-insensitively", async () => {
    const client = await pooledAnonClient(38);
    const pax = passenger("25", "female");
    const ticket = okData(await book(client, [pax]));
    await clearAttempts(ticket.pnr);

    try {
      const found = okData(await lookup(ticket.pnr.toLowerCase(), pax.phone));
      expect(found.id).toBe(ticket.id);
      expect(found.pnr).toBe(ticket.pnr);
      expect(found.qrPayload).toBe(ticket.qrPayload);
      expect(found.trip.id).toBe(TRIP);
      expect(found.passengers).toHaveLength(1);
    } finally {
      await clearAttempts(ticket.pnr);
    }
  });

  it("a wrong phone and a wrong pnr produce BYTE-IDENTICAL NOT_FOUND envelopes", async () => {
    const client = await pooledAnonClient(38);
    const pax = passenger("26", "male");
    const ticket = okData(await book(client, [pax]));
    await clearAttempts(ticket.pnr);

    try {
      const wrongPhone = await lookup(ticket.pnr, phone()); // real pnr, wrong phone
      const wrongPnr = await lookup("ZZZZZZ", pax.phone); // wrong pnr, real phone

      expectError(wrongPhone, "NOT_FOUND");
      expectError(wrongPnr, "NOT_FOUND");
      // Literal payload comparison: any difference at all is an oracle telling an
      // attacker "this PNR exists, keep guessing the phone".
      expect(JSON.stringify(wrongPhone)).toBe(JSON.stringify(wrongPnr));
    } finally {
      await clearAttempts(ticket.pnr);
      await clearAttempts("ZZZZZZ");
    }
  });

  it("beyond the hourly limit the correct pair also returns NOT_FOUND", async () => {
    const client = await pooledAnonClient(38);
    const pax = passenger("27", "male");
    const ticket = okData(await book(client, [pax]));
    await clearAttempts(ticket.pnr);

    const { data: cfg } = await svc
      .from("app_config")
      .select("value")
      .eq("key", "lookup_rate_limit_max")
      .single();
    const max = Number(cfg!.value);

    try {
      // Attempts are recorded for hits AND misses, so a correct pair burns quota too.
      for (let i = 0; i < max; i++) {
        const res = await lookup(ticket.pnr, pax.phone);
        expect(res.ok, `attempt ${i + 1} should still succeed`).toBe(true);
      }

      const blocked = await lookup(ticket.pnr, pax.phone);
      expectError(blocked, "NOT_FOUND");
      // Same envelope as any other miss — the limit itself must not be visible.
      const miss = await lookup("YYYYYY", pax.phone);
      expect(JSON.stringify(blocked)).toBe(JSON.stringify(miss));
    } finally {
      await clearAttempts(ticket.pnr);
      await clearAttempts("YYYYYY");
    }
  });
});

// ===========================================================================
// Trip validity
// ===========================================================================
describe("create_booking — trip validity", () => {
  it("a trip that departs between the lock and the booking → TRIP_DEPARTED", async () => {
    // A dedicated trip so no seeded fixture is left mutated.
    const DEPARTING = "000000ee-0000-4000-8000-000000004444";
    await wipe(DEPARTING);
    await svc.from("trips").delete().eq("id", DEPARTING);
    await svc.from("trips").insert({
      id: DEPARTING,
      company_id: AHLIA,
      route_id: LATAKIA_ROUTE,
      bus_id: AHLIA_BUS,
      departure_at: new Date(Date.now() + 3 * 3_600_000).toISOString(),
      arrival_at: new Date(Date.now() + 7 * 3_600_000).toISOString(),
      price: TRIP_PRICE,
      status: "published",
    });

    try {
      const client = await pooledAnonClient(39);
      const { lockId } = await lockSeats(
        client,
        [{ seatNumber: "2", gender: "male" }],
        DEPARTING,
      );

      await svc
        .from("trips")
        .update({ departure_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", DEPARTING);

      const res = await createBooking(client, {
        lockId,
        key: crypto.randomUUID(),
        passengers: [passenger("2", "male")],
      });
      expectError(res, "TRIP_DEPARTED");
      expect(await bookingRows(DEPARTING)).toHaveLength(0);
    } finally {
      await wipe(DEPARTING);
      await svc.from("trips").delete().eq("id", DEPARTING);
    }
  });
});
