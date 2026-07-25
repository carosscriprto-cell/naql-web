import { z } from "zod";

import { tripSearchItemSchema } from "@/features/search/schemas";

export const genderSchema = z.enum(["male", "female"]);

export const seatStatusSchema = z.enum(["available", "locked", "booked"]);

// Gender is present only on locked/booked seats (docs/BACKEND_V1.md §3).
export const seatSchema = z.object({
  number: z.string(),
  row: z.number().int(),
  col: z.number().int(),
  status: seatStatusSchema,
  gender: genderSchema.optional(),
});

export const seatMapSchema = z.object({
  layout: z.object({
    rows: z.number().int(),
    cols: z.number().int(),
    aisleAfterCol: z.number().int(),
  }),
  seats: z.array(seatSchema),
});

// Lock request/response (docs/BACKEND_V1.md §3).
export const seatSelectionSchema = z.object({
  seatNumber: z.string(),
  gender: genderSchema,
});

export const lockResponseSchema = z.object({
  lockId: z.string(),
  expiresAt: z.string(),
});

// Passenger checkout form (PAS-6). Built per-render with the active translator
// so validation messages come from ar.json (mirrors search-form-schema).
type Translator = (key: string) => string;

export function buildPassengerSchema(t: Translator) {
  return z.object({
    seatNumber: z.string(),
    gender: genderSchema,
    fullName: z.string().trim().min(3, t("errors.nameRequired")),
    phone: z.string().regex(/^\+9639\d{8}$/, t("errors.phoneInvalid")),
  });
}

export function buildCheckoutSchema(t: Translator) {
  return z.object({ passengers: z.array(buildPassengerSchema(t)) });
}

// Booking (docs/BACKEND_V1.md §4).
export const bookingPassengerSchema = z.object({
  seatNumber: z.string(),
  fullName: z.string(),
  phone: z.string(),
  gender: genderSchema,
});

export const bookingSchema = z.object({
  id: z.string(),
  pnr: z.string(),
  status: z.literal("confirmed"),
  qrPayload: z.string(),
  trip: tripSearchItemSchema,
  passengers: z.array(bookingPassengerSchema),
  totalPrice: z.number().int(),
});

export type Gender = z.infer<typeof genderSchema>;
export type SeatStatus = z.infer<typeof seatStatusSchema>;
export type Seat = z.infer<typeof seatSchema>;
export type SeatMap = z.infer<typeof seatMapSchema>;
export type SeatSelection = z.infer<typeof seatSelectionSchema>;
export type LockResponse = z.infer<typeof lockResponseSchema>;
export type PassengerFormValues = z.infer<
  ReturnType<typeof buildPassengerSchema>
>;
export type CheckoutFormValues = z.infer<
  ReturnType<typeof buildCheckoutSchema>
>;
export type BookingPassenger = z.infer<typeof bookingPassengerSchema>;
export type Booking = z.infer<typeof bookingSchema>;
export type CreateBookingPayload = {
  lockId: string;
  idempotencyKey: string;
  paymentMethod: "cash";
  passengers: BookingPassenger[];
};
