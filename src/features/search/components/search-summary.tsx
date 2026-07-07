"use client";

import { useState } from "react";
import { format, isValid, parseISO } from "date-fns";
import { ar } from "date-fns/locale";
import { ArrowLeftIcon, CalendarIcon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCities } from "../hooks/use-cities";
import { SearchForm } from "./search-form";

type SearchSummaryProps = {
  from: string;
  to: string;
  date: string;
  passengers: string;
};

export function SearchSummary({
  from,
  to,
  date,
  passengers,
}: SearchSummaryProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);
  const { data: cities } = useCities();

  const cityName = (slug: string) =>
    cities?.find((city) => city.slug === slug)?.nameAr ?? slug;
  const parsedDate = parseISO(date);

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            <span className="flex items-center gap-1.5 font-semibold">
              {cityName(from)}
              <ArrowLeftIcon className="text-primary size-4" aria-hidden />
              {cityName(to)}
            </span>
            {isValid(parsedDate) && (
              <span className="text-muted-foreground flex items-center gap-1.5">
                <CalendarIcon className="size-4" aria-hidden />
                {format(parsedDate, "EEEE d MMMM", { locale: ar })}
              </span>
            )}
            <span className="text-muted-foreground flex items-center gap-1.5">
              <UsersIcon className="size-4" aria-hidden />
              {t("searchForm.passengersCount", {
                count: Number(passengers) || 1,
              })}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing((open) => !open)}
            aria-expanded={editing}
          >
            {t("searchPage.edit")}
          </Button>
        </CardContent>
      </Card>

      {editing && (
        <SearchForm
          initialValues={{
            from,
            to,
            passengers,
            date: isValid(parsedDate) ? parsedDate : undefined,
          }}
        />
      )}
    </div>
  );
}
