import { http, HttpResponse } from "msw";

import { getTrip, trips, type TripDetail } from "./data";

// Catalog + search moved to Supabase in E2; the booking flow (seat map, lock,
// release, create) moved in E3 — those handlers are gone, along with the
// in-memory lock/booking state that only they used.
//
// What is left is ONE route: POST /api/bookings/lookup, which Task E4 replaces
// with rpc("lookup_booking"). It stays because /tickets/lookup does not exist
// yet, and deleting it now would leave the seeded CANCELLED ticket — the only
// way to demo the cancelled-ticket UI — unreachable.
//
// axios and src/lib/api-client.ts stay in place for the same reason.
//
// §0 envelope helpers — { ok: true, data } or { ok: false, error }.
const ok = (data: unknown) => HttpResponse.json({ ok: true, data });
const fail = (
  code: string,
  message: string,
  details?: Record<string, unknown>,
) => HttpResponse.json({ ok: false, error: { code, message, details } });

type Gender = "male" | "female";
type BookingPassenger = {
  seatNumber: string;
  fullName: string;
  phone: string;
  gender: Gender;
};
type BookingRecord = {
  id: string;
  pnr: string;
  status: "confirmed" | "cancelled";
  qrPayload: string;
  trip: TripDetail | undefined;
  passengers: BookingPassenger[];
  totalPrice: number;
};

// PNR → booking, the index behind lookup (§4). Seeded with a CANCELLED booking
// so the cancelled ticket state is demoable:
//   POST /api/bookings/lookup  { "pnr": "CANCLD", "phone": "+963911223344" }
//
// Since E3 this map is no longer written to — real bookings live in Postgres and
// are retrieved with lookup_booking. It holds exactly this one fixture until E4
// removes the route.
const CANCELLED_BOOKING: BookingRecord = {
  id: "000000e9-0000-4000-8000-000000000001",
  pnr: "CANCLD",
  status: "cancelled",
  // Still a well-formed payload — a cancelled ticket's QR scans and is REJECTED
  // at the gate; it does not become unreadable.
  qrPayload: "000000e9-0000-4000-8000-000000000001.cancelled",
  trip: getTrip(trips[0].id),
  passengers: [
    {
      seatNumber: "5",
      fullName: "سمير حسن",
      phone: "+963911223344",
      gender: "male",
    },
  ],
  totalPrice: trips[0].price,
};
const bookingsByPnr = new Map<string, BookingRecord>([
  [CANCELLED_BOOKING.pnr, CANCELLED_BOOKING],
]);

export const handlers = [
  // Cross-device ticket retrieval (§4). The (pnr, phone) PAIR must match a
  // passenger on that booking; a wrong pnr and a wrong phone return the SAME
  // NOT_FOUND, so the response never reveals which half was right.
  // Cancelled bookings ARE returned — the passenger needs to see the ticket is
  // dead, and filtering them out would re-open the enumeration leak.
  http.post("/api/bookings/lookup", async ({ request }) => {
    const body = (await request.json()) as { pnr?: string; phone?: string };
    const booking = bookingsByPnr.get((body.pnr ?? "").trim().toUpperCase());
    const phone = (body.phone ?? "").trim();
    const matched = booking?.passengers.some((p) => p.phone === phone);
    return matched && booking
      ? ok(booking)
      : fail("NOT_FOUND", "لم نعثر على حجز بهذه البيانات");
  }),
];
