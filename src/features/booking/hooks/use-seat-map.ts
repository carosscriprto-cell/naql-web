"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchSeatMap } from "../api";

export function useSeatMap(tripId: string) {
  return useQuery({
    queryKey: queryKeys.trips.seats(tripId),
    queryFn: () => fetchSeatMap(tripId),
    enabled: Boolean(tripId),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}
