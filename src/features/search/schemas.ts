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
  company: z.object({
    id: z.string(),
    name: z.string(),
    logoUrl: z.string(),
    rating: z.number(),
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

// Inner data payload of the GET /trips/search envelope (docs/BACKEND_V1.md
// §0). The { ok, data } envelope itself is peeled off by unwrap().
export const tripSearchResponseSchema = z.object({
  items: z.array(tripSearchItemSchema),
  meta: z.object({
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
  }),
});

// Trip details = the search item shape plus the cancellation policy text
// (docs/BACKEND_V1.md §2, GET /trips/:id). Reuses the sub-schemas above.
export const tripDetailSchema = tripSearchItemSchema.extend({
  cancellationPolicy: z.string(),
});

export type City = z.infer<typeof citySchema>;
export type TripSearchItem = z.infer<typeof tripSearchItemSchema>;
export type TripDetail = z.infer<typeof tripDetailSchema>;
