import { http, HttpResponse } from "msw";

import { getCities, getSeatMap, getTrip, searchTrips } from "./data";

// §0 envelope helpers — every handler returns { ok: true, data } on success
// or { ok: false, error } on failure. Shared by all current and future routes.
const ok = (data: unknown) => HttpResponse.json({ ok: true, data });
const fail = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => HttpResponse.json({ ok: false, error: { code, message, details } });

type Gender = "male" | "female";
type SeatSelection = { seatNumber: string; gender: Gender };
type LockedSeat = { gender: Gender; expiresAt: number };
type BookingPassenger = {
  seatNumber: string;
  fullName: string;
  phone: string;
  gender: Gender;
};
type CreateBookingBody = {
  lockId: string;
  idempotencyKey: string;
  paymentMethod: string;
  passengers: BookingPassenger[];
};

const LOCK_TTL_MS = 10 * 60_000;

// In-memory lock state (mirrors the Supabase seat_lock_seats table). Per-trip
// seat → gender+expiry, plus a lockId index for release. Resets on page reload.
const seatLocksByTrip = new Map<string, Map<string, LockedSeat>>();
const locksById = new Map<string, { tripId: string; seats: string[] }>();
// Seats booked this session (per trip) so the map shows them booked + gender.
const bookedByTrip = new Map<string, Map<string, Gender>>();
// idempotencyKey → { payload hash, stored response } for replay (mirrors §4).
const idempotencyStore = new Map<string, { hash: string; data: unknown }>();

// PNR alphabet excludes 0 O 1 I (docs/BACKEND_V1.md §4).
const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makePnr(): string {
  let pnr = "";
  for (let i = 0; i < 6; i++) {
    pnr += PNR_ALPHABET[Math.floor(Math.random() * PNR_ALPHABET.length)];
  }
  return pnr;
}
function bookingHash(body: CreateBookingBody): string {
  return JSON.stringify({
    lockId: body.lockId,
    paymentMethod: body.paymentMethod,
    passengers: body.passengers,
  });
}

/** Active (non-expired) locks for a trip; expires entries on read (no cron). */
function activeLocks(tripId: string): Map<string, LockedSeat> {
  const now = Date.now();
  const locks = seatLocksByTrip.get(tripId) ?? new Map<string, LockedSeat>();
  for (const [number, lock] of locks) {
    if (lock.expiresAt <= now) locks.delete(number);
  }
  seatLocksByTrip.set(tripId, locks);
  return locks;
}

export const handlers = [
  http.get("/api/cities", () => ok(getCities())),

  http.get("/api/trips/search", ({ request }) => {
    const params = new URL(request.url).searchParams;
    const items = searchTrips(
      params.get("from") ?? "",
      params.get("to") ?? "",
      params.get("date") ?? "",
    );
    return ok({
      items,
      meta: { page: 1, perPage: 20, total: items.length },
    });
  }),

  http.get("/api/trips/:id", ({ params }) => {
    const trip = getTrip(String(params.id));
    return trip ? ok(trip) : fail("NOT_FOUND", "الرحلة غير موجودة");
  }),

  // Base map overlaid with live locks + session bookings so gender is visible
  // to every viewer.
  http.get("/api/trips/:id/seats", ({ params }) => {
    const tripId = String(params.id);
    const base = getSeatMap();
    const locks = activeLocks(tripId);
    const booked = bookedByTrip.get(tripId);
    const seats = base.seats.map((seat) => {
      if (seat.status !== "available") return seat;
      const bookedGender = booked?.get(seat.number);
      if (bookedGender) {
        return { ...seat, status: "booked", gender: bookedGender };
      }
      const lock = locks.get(seat.number);
      return lock ? { ...seat, status: "locked", gender: lock.gender } : seat;
    });
    return ok({ ...base, seats });
  }),

  http.post("/api/trips/:id/seats/lock", async ({ params, request }) => {
    const tripId = String(params.id);
    const body = (await request.json()) as { seats: SeatSelection[] };
    const requested = body.seats ?? [];
    const base = getSeatMap();
    const booked = new Set(
      base.seats.filter((s) => s.status === "booked").map((s) => s.number),
    );
    const locks = activeLocks(tripId);

    const bookedConflicts = requested
      .filter((s) => booked.has(s.seatNumber))
      .map((s) => s.seatNumber);
    if (bookedConflicts.length > 0) {
      return fail("SEAT_ALREADY_BOOKED", "بعض المقاعد محجوزة بالفعل", {
        seats: bookedConflicts,
      });
    }

    // Seat "13" is the deterministic conflict trigger (CLAUDE.md).
    const lockedConflicts = requested
      .filter((s) => s.seatNumber === "13" || locks.has(s.seatNumber))
      .map((s) => s.seatNumber);
    if (lockedConflicts.length > 0) {
      return fail("SEAT_ALREADY_LOCKED", "تم حجز بعض المقاعد للتو", {
        seats: lockedConflicts,
      });
    }

    const lockId = crypto.randomUUID();
    const expiresAt = Date.now() + LOCK_TTL_MS;
    for (const seat of requested) {
      locks.set(seat.seatNumber, { gender: seat.gender, expiresAt });
    }
    locksById.set(lockId, { tripId, seats: requested.map((s) => s.seatNumber) });
    return ok({ lockId, expiresAt: new Date(expiresAt).toISOString() });
  }),

  http.post("/api/locks/:lockId/release", ({ params }) => {
    const lock = locksById.get(String(params.lockId));
    if (lock) {
      const locks = seatLocksByTrip.get(lock.tripId);
      for (const number of lock.seats) locks?.delete(number);
      locksById.delete(String(params.lockId));
    }
    return ok(null); // idempotent — releasing a gone lock is still ok
  }),

  http.post("/api/bookings", async ({ request }) => {
    const body = (await request.json()) as CreateBookingBody;

    // Idempotency first — replay on same key, conflict on same key + new body.
    const prior = idempotencyStore.get(body.idempotencyKey);
    if (prior) {
      return prior.hash === bookingHash(body)
        ? ok(prior.data)
        : fail("IDEMPOTENCY_CONFLICT", "طلب مكرر بمحتوى مختلف");
    }

    // Lock must exist and be unexpired.
    const lock = locksById.get(body.lockId);
    if (!lock) return fail("LOCK_EXPIRED", "انتهت مهلة الحجز");
    const tripLocks = activeLocks(lock.tripId);
    if (!lock.seats.every((n) => tripLocks.has(n))) {
      return fail("LOCK_EXPIRED", "انتهت مهلة الحجز");
    }

    // Passenger gender must match the gender declared on that seat's lock.
    for (const passenger of body.passengers) {
      if (tripLocks.get(passenger.seatNumber)?.gender !== passenger.gender) {
        return fail("VALIDATION_ERROR", "جنس الراكب لا يطابق المقعد المحجوز", {
          field: `passenger.${passenger.seatNumber}.gender`,
        });
      }
    }

    // Deterministic anti-abuse demo: any phone ending in "00".
    if (body.passengers.some((p) => p.phone.endsWith("00"))) {
      return fail("BOOKING_LIMIT_REACHED", "تجاوزت الحد المسموح من الحجوزات");
    }

    const trip = getTrip(lock.tripId);
    const id = crypto.randomUUID();
    const data = {
      id,
      pnr: makePnr(),
      status: "confirmed",
      qrPayload: `${id}.${crypto.randomUUID().replace(/-/g, "")}`,
      trip,
      passengers: body.passengers,
      totalPrice: (trip?.price ?? 0) * body.passengers.length,
    };

    // Consume the lock → mark seats booked so the map stays truthful.
    const booked = bookedByTrip.get(lock.tripId) ?? new Map<string, Gender>();
    for (const number of lock.seats) {
      const gender = tripLocks.get(number)?.gender;
      if (gender) booked.set(number, gender);
      tripLocks.delete(number);
    }
    bookedByTrip.set(lock.tripId, booked);
    locksById.delete(body.lockId);

    idempotencyStore.set(body.idempotencyKey, { hash: bookingHash(body), data });
    return ok(data);
  }),
];
