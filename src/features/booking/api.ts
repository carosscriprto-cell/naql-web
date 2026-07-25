import { z } from "zod";

import { api } from "@/lib/api-client";
import { unwrap } from "@/lib/envelope";
import { mocksReady } from "@/mocks/init";
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

export async function fetchSeatMap(tripId: string): Promise<SeatMap> {
  await mocksReady();
  const response = await api.get(`/trips/${tripId}/seats`);
  return unwrap(response.data, seatMapSchema);
}

export async function lockSeats(
  tripId: string,
  seats: SeatSelection[],
): Promise<LockResponse> {
  await mocksReady();
  const response = await api.post(`/trips/${tripId}/seats/lock`, { seats });
  return unwrap(response.data, lockResponseSchema);
}

export async function releaseLock(lockId: string): Promise<null> {
  await mocksReady();
  const response = await api.post(`/locks/${lockId}/release`);
  return unwrap(response.data, z.null());
}

export async function createBooking(
  payload: CreateBookingPayload,
): Promise<Booking> {
  await mocksReady();
  const response = await api.post("/bookings", payload);
  return unwrap(response.data, bookingSchema);
}
