"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchTrips, type TripSearchParams } from "../api";

export function useSearchTrips(params: TripSearchParams) {
  return useQuery({
    queryKey: queryKeys.trips.search(params),
    queryFn: () => fetchTrips(params),
    enabled: Boolean(params.from && params.to && params.date),
  });
}
