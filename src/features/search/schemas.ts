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

// Pagination envelope for list endpoints (docs/BACKEND_V1.md §0).
export const tripSearchResponseSchema = z.object({
  data: z.array(tripSearchItemSchema),
  meta: z.object({
    page: z.number().int(),
    perPage: z.number().int(),
    total: z.number().int(),
  }),
});

export type City = z.infer<typeof citySchema>;
export type TripSearchItem = z.infer<typeof tripSearchItemSchema>;
