import { z } from "zod";

import { callRpc } from "@/lib/rpc";
import { browserClient, ensureSession } from "@/lib/supabase/browser";
import {
  bookingSchema,
  lockResponseSchema,
  seatMapSchema,
  type Booking,
  type CreateBookingPayload,
  type LockResponse,
  type SeatMap,
  type SeatSelection,
} from "./schemas";

// E3 — the booking flow now talks to Supabase directly (BACKEND_V1 §3/§4).
// Only the internals changed: every exported signature, every zod schema and
// every `ApiError.code` the UI keys on is what it was under MSW, because the
// envelope seam (lib/envelope.ts `unwrap()`, reached through `callRpc`) is the
// same one both eras go through.
//
// All four RPCs are ENVELOPED — each has a real domain failure mode — so all
// four use `callRpc`, never `callRpcBare`.
//
// ARGUMENT NAMES ARE `p_`-PREFIXED AND NOT SYMMETRIC ACROSS THE SCHEMA.
// PostgREST resolves a function by its argument NAMES, so a wrong one is a
// runtime PGRST202 surfaced as `NETWORK_ERROR`, not a compile error — the
// generated `Args` types are the only thing that catches it, which is why the
// client is typed. Verified against the migration source, not by analogy:
//   get_seat_map(p_trip_id)                                    20260726141549
//   lock_seats(p_trip_id, p_seats)                             20260726135700
//   release_lock(p_lock_id)                                    20260726135700
//   create_booking(p_lock_id, p_idempotency_key,
//                  p_payment_method, p_passengers)             20260727150000
// (Elsewhere in the schema `get_booking` takes `p_id` while `cancel_booking`
// takes `p_booking_id`. Do not infer either from the other.)

/**
 * §3. Enveloped read — `NOT_FOUND` for a missing / draft / suspended-company
 * trip; a DEPARTED trip still returns its map, which is what lets the UI render
 * the disabled state.
 *
 * No `ensureSession()` here on purpose. `get_seat_map` is granted to `anon`, and
 * this runs on every seat-map poll — minting an anonymous identity for a visitor
 * who is only looking would burn the sign-in rate limit and contradict §1, which
 * puts identity creation at the first LOCK attempt.
 */
export async function fetchSeatMap(tripId: string): Promise<SeatMap> {
  return callRpc(
    browserClient(),
    "get_seat_map",
    { p_trip_id: tripId },
    seatMapSchema,
  );
}

/**
 * §3. The first write in the flow, and therefore where the anonymous identity is
 * created (§1). Without a session `lock_seats` returns `UNAUTHORIZED` — the lock
 * binds to `auth.uid()`, so there is nothing to bind to.
 *
 * `p_seats` is `[{ seatNumber, gender }]` — the seat map emits `number`, but the
 * lock request takes `seatNumber`. That asymmetry is deliberate (§3) and the
 * store already holds the `seatNumber` shape.
 */
export async function lockSeats(
  tripId: string,
  seats: SeatSelection[],
): Promise<LockResponse> {
  await ensureSession();
  return callRpc(
    browserClient(),
    "lock_seats",
    { p_trip_id: tripId, p_seats: seats },
    lockResponseSchema,
  );
}

/**
 * §3. Idempotent: releasing a lock that is already gone still returns ok, so the
 * best-effort release on leaving checkout cannot fail loudly. Owner-only —
 * a non-owner gets `FORBIDDEN`.
 *
 * No `ensureSession()`: holding a `lockId` at all means the session that created
 * it already exists.
 */
export async function releaseLock(lockId: string): Promise<null> {
  return callRpc(
    browserClient(),
    "release_lock",
    { p_lock_id: lockId },
    z.null(),
  );
}

/**
 * §4. One transaction: validates the lock, inserts booking + passengers,
 * snapshots the commission rate, consumes the lock.
 *
 * `ensureSession()` again rather than assuming `lockSeats` already ran: the
 * store survives a reload, so checkout can be reached with a `lockId` in hand
 * and no live session. Recovering it here means the caller gets the honest
 * `LOCK_EXPIRED` (the lock belongs to the old identity) instead of a confusing
 * `UNAUTHORIZED` from a flow that plainly is authorised.
 *
 * `idempotencyKey` travels as an RPC ARGUMENT, never an HTTP header (CLAUDE.md).
 */
export async function createBooking(
  payload: CreateBookingPayload,
): Promise<Booking> {
  await ensureSession();
  return callRpc(
    browserClient(),
    "create_booking",
    {
      p_lock_id: payload.lockId,
      p_idempotency_key: payload.idempotencyKey,
      p_payment_method: payload.paymentMethod,
      p_passengers: payload.passengers,
    },
    bookingSchema,
  );
}
