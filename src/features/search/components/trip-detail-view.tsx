"use client";

import { useState } from "react";
import { differenceInMinutes, format } from "date-fns";
import { ar } from "date-fns/locale";
import { BusFrontIcon, ShieldCheckIcon, StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { SeatSelection } from "@/features/booking/components/seat-selection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TripDetail } from "../schemas";

export function TripDetailView({ trip }: { trip: TripDetail }) {
  const t = useTranslations("tripDetail");
  const tSearch = useTranslations("searchPage");
  const departure = new Date(trip.departureAt);
  const arrival = new Date(trip.arrivalAt);
  const totalMinutes = differenceInMinutes(arrival, departure);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration = [
    hours > 0 ? tSearch("durationHours", { hours }) : null,
    minutes > 0 ? tSearch("durationMinutes", { minutes }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Snapshot "now" once at mount; the CTA state doesn't need to tick live.
  const [now] = useState(() => Date.now());
  const departed = departure.getTime() < now;
  const full = trip.availableSeats === 0;
  const disabled = departed || full;
  const ctaLabel = departed
    ? t("ctaDeparted")
    : full
      ? t("ctaFull")
      : t("cta");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-44">
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-sm">
                {format(departure, "EEEE d MMMM", { locale: ar })}
              </p>
              <Badge variant={trip.busType === "VIP" ? "default" : "outline"}>
                {trip.busType}
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-center">
                <p className="text-xl leading-tight font-bold">
                  {format(departure, "h:mm a", { locale: ar })}
                </p>
                <p className="text-muted-foreground text-sm">
                  {trip.fromCity.nameAr}
                </p>
              </div>
              <div className="relative mx-1 flex-1">
                <div className="border-t border-dashed" />
                <span className="bg-card text-muted-foreground absolute inset-x-0 -top-2.5 mx-auto w-fit px-2 text-xs">
                  {duration}
                </span>
              </div>
              <div className="text-center">
                <p className="text-xl leading-tight font-bold">
                  {format(arrival, "h:mm a", { locale: ar })}
                </p>
                <p className="text-muted-foreground text-sm">
                  {trip.toCity.nameAr}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-full">
                <BusFrontIcon className="size-5" aria-hidden />
              </span>
              <div>
                <p className="text-muted-foreground text-xs">{t("company")}</p>
                <p className="font-semibold">{trip.company.name}</p>
              </div>
            </div>
            {/* rating is nullable (§2) — omit the element for an unrated
                company rather than rendering a 0 or a placeholder. */}
            {trip.company.rating !== null && (
              <p className="text-muted-foreground flex items-center gap-1 text-sm">
                <StarIcon
                  className="size-4 fill-amber-400 text-amber-400"
                  aria-hidden
                />
                {trip.company.rating}
              </p>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardContent className="flex items-center justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs">
                {t("pricePerSeat")}
              </p>
              <p className="text-primary text-xl font-bold">
                {tSearch("price", { price: trip.price })}
              </p>
            </div>
            <p className="text-muted-foreground text-sm">
              {tSearch("seatsAvailable", { count: trip.availableSeats })}
            </p>
          </CardContent>
        </Card>

        <div className="bg-primary/5 flex items-start gap-2 rounded-3xl p-4">
          <ShieldCheckIcon className="text-primary mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="text-sm font-medium">{t("cancellationTitle")}</p>
            <p className="text-muted-foreground text-sm">
              {trip.cancellationPolicy}
            </p>
          </div>
        </div>

        <div id="seats" className="scroll-mt-20">
          <h2 className="mb-3 text-lg font-semibold">{t("seatSelection")}</h2>
          {disabled ? (
            <Card size="sm">
              <CardContent className="text-muted-foreground py-8 text-center text-sm">
                {ctaLabel}
              </CardContent>
            </Card>
          ) : (
            <SeatSelection tripId={trip.id} pricePerSeat={trip.price} />
          )}
        </div>
      </div>

      {/* Departed/full trips have no selection bar — show the disabled CTA
          (AC-2); enabled trips get the booking SelectionBar instead. */}
      {disabled && (
        <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur">
          <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-primary text-lg font-bold">
                {tSearch("price", { price: trip.price })}
              </p>
              <p className="text-destructive text-xs">{ctaLabel}</p>
            </div>
            <Button size="lg" disabled>
              {ctaLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
