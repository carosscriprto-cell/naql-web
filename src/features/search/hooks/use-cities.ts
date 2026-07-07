"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchCities } from "../api";

export function useCities() {
  return useQuery({
    queryKey: queryKeys.cities.all,
    queryFn: fetchCities,
    staleTime: Infinity,
  });
}
