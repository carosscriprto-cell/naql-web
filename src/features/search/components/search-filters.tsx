"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchTrips } from "../hooks/use-search-trips";
import {
  DEPARTURE_WINDOWS,
  useTripFilters,
  type BusFilter,
  type TripSort,
} from "../hooks/use-trip-filters";

function FilterChip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export function SearchFilters() {
  const t = useTranslations("filters");
  const searchParams = useSearchParams();
  const { filters, activeCount, ...actions } = useTripFilters();

  // Same query key as the results list — served from the cache.
  const { data: trips } = useSearchTrips({
    from: searchParams.get("from") ?? "",
    to: searchParams.get("to") ?? "",
    date: searchParams.get("date") ?? "",
  });
  const companies = [
    ...new Map(
      (trips ?? []).map((trip) => [trip.company.id, trip.company]),
    ).values(),
  ];

  const sortItems: { value: TripSort; label: string }[] = [
    { value: "departure", label: t("sortDeparture") },
    { value: "price", label: t("sortPrice") },
  ];

  return (
    <div className="flex flex-col gap-6">
      <FilterSection title={t("departureWindow")}>
        {DEPARTURE_WINDOWS.map((window) => (
          <FilterChip
            key={window}
            selected={filters.windows.includes(window)}
            onClick={() => actions.toggleWindow(window)}
          >
            {t(`windows.${window}`)}
          </FilterChip>
        ))}
      </FilterSection>

      {companies.length > 0 && (
        <FilterSection title={t("company")}>
          {companies.map((company) => (
            <FilterChip
              key={company.id}
              selected={filters.companies.includes(company.id)}
              onClick={() => actions.toggleCompany(company.id)}
            >
              {company.name}
            </FilterChip>
          ))}
        </FilterSection>
      )}

      <FilterSection title={t("busType")}>
        {(["standard", "vip"] as BusFilter[]).map((bus) => (
          <FilterChip
            key={bus}
            selected={filters.bus === bus}
            onClick={() => actions.setBus(filters.bus === bus ? null : bus)}
          >
            {t(bus)}
          </FilterChip>
        ))}
      </FilterSection>

      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-semibold">{t("sort")}</h3>
        <Select
          items={sortItems}
          value={filters.sort}
          onValueChange={(sort) => actions.setSort(sort ?? "departure")}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeCount > 0 && (
        <Button type="button" variant="ghost" onClick={actions.clearAll}>
          {t("clear")}
        </Button>
      )}
    </div>
  );
}
