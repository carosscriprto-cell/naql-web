import { z } from "zod";

import { api } from "@/lib/api-client";
import { mocksReady } from "@/mocks/init";
import {
  citySchema,
  tripSearchResponseSchema,
  type City,
  type TripSearchItem,
} from "./schemas";

// Real HTTP through the axios client; in mock mode MSW intercepts the
// requests (src/mocks/handlers.ts). Every response is zod-parsed.
export async function fetchCities(): Promise<City[]> {
  await mocksReady();
  const response = await api.get("/cities");
  return z.array(citySchema).parse(response.data);
}

export type TripSearchParams = {
  from: string;
  to: string;
  date: string;
};

export async function fetchTrips(
  params: TripSearchParams,
): Promise<TripSearchItem[]> {
  await mocksReady();
  const response = await api.get("/trips/search", { params });
  return tripSearchResponseSchema.parse(response.data).data;
}
