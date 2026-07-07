import type { TripSearchItem } from "./schemas";
import type { DepartureWindow, TripFilters } from "./hooks/use-trip-filters";

// [start, end) in local hours — matches the times the user sees on the cards.
const WINDOW_RANGES: Record<DepartureWindow, [number, number]> = {
  morning: [5, 12],
  noon: [12, 17],
  evening: [17, 24],
};

export function filterAndSortTrips(
  trips: TripSearchItem[],
  filters: TripFilters,
): TripSearchItem[] {
  const visible = trips.filter((trip) => {
    if (filters.windows.length > 0) {
      const hour = new Date(trip.departureAt).getHours();
      const inWindow = filters.windows.some((window) => {
        const [start, end] = WINDOW_RANGES[window];
        return hour >= start && hour < end;
      });
      if (!inWindow) return false;
    }
    if (
      filters.companies.length > 0 &&
      !filters.companies.includes(trip.company.id)
    ) {
      return false;
    }
    if (filters.bus) {
      const busType = filters.bus === "vip" ? "VIP" : "عادي";
      if (trip.busType !== busType) return false;
    }
    return true;
  });

  return visible.toSorted((a, b) =>
    filters.sort === "price"
      ? a.price - b.price
      : a.departureAt.localeCompare(b.departureAt),
  );
}
