import { z } from "zod";

import { api } from "@/lib/api-client";
import { unwrap } from "@/lib/envelope";
import { mocksReady } from "@/mocks/init";
import {
  citySchema,
  tripDetailSchema,
  tripSearchListSchema,
  type City,
  type TripDetail,
  type TripSearchItem,
} from "./schemas";

// Real HTTP through the axios client; in mock mode MSW intercepts the
// requests (src/mocks/handlers.ts). Every response is zod-parsed.
export async function fetchCities(): Promise<City[]> {
  await mocksReady();
  const response = await api.get("/cities");
  return unwrap(response.data, z.array(citySchema));
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
  return unwrap(response.data, tripSearchListSchema);
}

export async function getTrip(id: string): Promise<TripDetail> {
  await mocksReady();
  const response = await api.get(`/trips/${id}`);
  return unwrap(response.data, tripDetailSchema);
}
