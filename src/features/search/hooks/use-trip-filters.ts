"use client";

import { useRouter, useSearchParams } from "next/navigation";

export const DEPARTURE_WINDOWS = ["morning", "noon", "evening"] as const;
export type DepartureWindow = (typeof DEPARTURE_WINDOWS)[number];

export type BusFilter = "standard" | "vip";
export type TripSort = "departure" | "price";

export type TripFilters = {
  windows: DepartureWindow[];
  companies: string[];
  bus: BusFilter | null;
  sort: TripSort;
};

// Filter/sort state lives only in the URL (PAS-2 AC-3) — this hook is the
// single read/write path; components hold no duplicate local state.
export function useTripFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const list = (key: string) =>
    (searchParams.get(key) ?? "").split(",").filter(Boolean);

  const bus = searchParams.get("bus");
  const filters: TripFilters = {
    windows: list("window").filter((w): w is DepartureWindow =>
      (DEPARTURE_WINDOWS as readonly string[]).includes(w),
    ),
    companies: list("company"),
    bus: bus === "standard" || bus === "vip" ? bus : null,
    sort: searchParams.get("sort") === "price" ? "price" : "departure",
  };

  // sort has a default and doesn't count as an "active filter"
  const activeCount =
    filters.windows.length + filters.companies.length + (filters.bus ? 1 : 0);

  function replaceParams(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    router.replace(`/search?${params.toString()}`, { scroll: false });
  }

  const setListParam = (key: string, values: string[]) =>
    replaceParams((params) => {
      if (values.length) params.set(key, values.join(","));
      else params.delete(key);
    });

  const toggle = (values: string[], value: string) =>
    values.includes(value)
      ? values.filter((v) => v !== value)
      : [...values, value];

  return {
    filters,
    activeCount,
    toggleWindow: (window: DepartureWindow) =>
      setListParam("window", toggle(filters.windows, window)),
    toggleCompany: (companyId: string) =>
      setListParam("company", toggle(filters.companies, companyId)),
    setBus: (bus: BusFilter | null) =>
      replaceParams((params) => {
        if (bus) params.set("bus", bus);
        else params.delete("bus");
      }),
    setSort: (sort: TripSort) =>
      replaceParams((params) => {
        if (sort === "departure") params.delete("sort");
        else params.set("sort", sort);
      }),
    clearAll: () =>
      replaceParams((params) => {
        for (const key of ["window", "company", "bus", "sort"]) {
          params.delete(key);
        }
      }),
  };
}
