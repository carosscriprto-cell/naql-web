"use client";

import Link from "next/link";
import { addDays, format, isValid, parseISO } from "date-fns";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { filterAndSortTrips } from "../filter-trips";
import { parsePassengers, useSearchTrips } from "../hooks/use-search-trips";
import { useTripFilters } from "../hooks/use-trip-filters";
import { SearchFiltersSheet } from "./search-filters-sheet";
import { TripCard } from "./trip-card";

type SearchResultsProps = {
  from: string;
  to: string;
  date: string;
  passengers: string;
};

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        {children}
      </CardContent>
    </Card>
  );
}

export function SearchResults({
  from,
  to,
  date,
  passengers,
}: SearchResultsProps) {
  const t = useTranslations("searchPage");
  const tFilters = useTranslations("filters");
  const { filters, clearAll } = useTripFilters();
  const {
    data: trips,
    isPending,
    isError,
  } = useSearchTrips({ from, to, date, passengers: parsePassengers(passengers) });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-4xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyCard>
        <p className="text-muted-foreground">{t("error")}</p>
      </EmptyCard>
    );
  }

  if (trips.length === 0) {
    const parsed = parseISO(date);
    const nextDay = format(
      addDays(isValid(parsed) ? parsed : new Date(), 1),
      "yyyy-MM-dd",
    );
    return (
      <EmptyCard>
        <p className="text-lg font-semibold">{t("empty.title")}</p>
        <p className="text-muted-foreground text-sm">
          {t("empty.description")}
        </p>
        <Button
          variant="outline"
          className="mt-2"
          render={
            <Link
              href={`/search?from=${from}&to=${to}&date=${nextDay}&passengers=${passengers}`}
            />
          }
        >
          {t("empty.nextDay")}
        </Button>
      </EmptyCard>
    );
  }

  const visible = filterAndSortTrips(trips, filters);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm" aria-live="polite">
          {tFilters("count", { count: visible.length })}
        </p>
        <SearchFiltersSheet />
      </div>

      {visible.length === 0 ? (
        <EmptyCard>
          <p className="text-muted-foreground">{tFilters("noMatches")}</p>
          <Button variant="outline" className="mt-1" onClick={clearAll}>
            {tFilters("clear")}
          </Button>
        </EmptyCard>
      ) : (
        visible.map((trip) => (
          <TripCard key={trip.id} trip={trip} passengers={passengers} />
        ))
      )}
    </div>
  );
}
