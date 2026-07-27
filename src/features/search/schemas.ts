import { z } from "zod";
import type {
  City as DomainCity,
  TripSearchItem as DomainTripSearchItem,
} from "@/types/domain";

export const citySchema = z.object({
  id: z.string(),
  nameAr: z.string(),
  nameEn: z.string(),
  slug: z.string(),
}) satisfies z.ZodType<DomainCity>;

export const tripSearchItemSchema = z.object({
  id: z.string(),
  // logoUrl / rating are nullable (docs/BACKEND_V1.md §2): companies.logo_url
  // and companies.rating are nullable columns, so an approved company with no
  // logo or no rating yet is valid. Requiring them here would fail the parse for
  // the WHOLE array and blank the search page over one incomplete company.
  // Nothing else loosens — ids, price, availableSeats and busType stay strict.
  company: z.object({
    id: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
    rating: z.number().nullable(),
  }),
  fromCity: z.object({ id: z.string(), nameAr: z.string() }),
  toCity: z.object({ id: z.string(), nameAr: z.string() }),
  departureAt: z.string(),
  arrivalAt: z.string(),
  price: z.number().int(),
  currency: z.literal("SYP"),
  availableSeats: z.number().int(),
  busType: z.enum(["عادي", "VIP"]),
}) satisfies z.ZodType<DomainTripSearchItem>;

// Search results are a bare array of trips (docs/BACKEND_V1.md §2) — the
// search_trips RPC returns the array directly. The { ok, data } envelope is
// peeled off by unwrap(); pagination was never part of §2.
export const tripSearchListSchema = z.array(tripSearchItemSchema);

// Trip details = the search item shape plus the cancellation policy text
// (docs/BACKEND_V1.md §2, GET /trips/:id). Reuses the sub-schemas above.
export const tripDetailSchema = tripSearchItemSchema.extend({
  cancellationPolicy: z.string(),
});

export type City = z.infer<typeof citySchema>;
export type TripSearchItem = z.infer<typeof tripSearchItemSchema>;
export type TripDetail = z.infer<typeof tripDetailSchema>;
