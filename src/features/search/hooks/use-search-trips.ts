"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchTrips, type TripSearchParams } from "../api";

export const DEFAULT_PASSENGERS = 1;

/**
 * The `passengers` URL param → the RPC's `p_passengers`. Absent, empty,
 * non-numeric, fractional or non-positive all fall back to 1, so a hand-edited
 * URL degrades to a normal search instead of an empty list. (The form only ever
 * emits "1".."5"; this guards everything else.)
 *
 * Every caller of useSearchTrips MUST normalise through this. The value is part
 * of the query key, so two callers disagreeing on it would split the cache —
 * the filter facets would then be derived from a different result set than the
 * list they filter.
 */
export function parsePassengers(raw: string | null | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PASSENGERS;
}

export function useSearchTrips(params: TripSearchParams) {
  return useQuery({
    // queryKeys.trips.search takes Record<string, string>; passengers is
    // stringified here so a change to it refetches rather than reusing a stale
    // list computed for a different party size.
    queryKey: queryKeys.trips.search({
      from: params.from,
      to: params.to,
      date: params.date,
      passengers: String(params.passengers),
    }),
    queryFn: () => fetchTrips(params),
    enabled: Boolean(params.from && params.to && params.date),
  });
}
