"use client";

import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TripDetail } from "@/features/search/schemas";
import type { SelectedSeat } from "../store";
import { GenderIcon } from "./gender-icon";

export function OrderSummary({
  trip,
  selectedSeats,
  isPending,
}: {
  trip: TripDetail;
  selectedSeats: SelectedSeat[];
  isPending: boolean;
}) {
  const t = useTranslations("checkout");
  const n = selectedSeats.length;
  const total = trip.price * n;
  const departure = new Date(trip.departureAt);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <h2 className="font-semibold">{t("summary.title")}</h2>

        <div>
          <p className="font-medium">
            {t("summary.route", {
              from: trip.fromCity.nameAr,
              to: trip.toCity.nameAr,
            })}
          </p>
          <p className="text-muted-foreground text-sm">
            {format(departure, "EEEE d MMMM · h:mm a", { locale: ar })}
          </p>
        </div>

        <div className="border-t" />

        <ul className="flex flex-col gap-2">
          {selectedSeats.map((seat) => (
            <li
              key={seat.seatNumber}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="flex items-center gap-1.5">
                <GenderIcon gender={seat.gender} className="size-3.5" />
                {t("seat", { number: seat.seatNumber })}
              </span>
              <span className="text-muted-foreground">{t(seat.gender)}</span>
            </li>
          ))}
        </ul>

        <div className="border-t" />

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t("summary.pricePerSeat")} · {t("summary.seatsCount", { count: n })}
          </span>
          <span>{t("price", { price: trip.price })}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="font-semibold">{t("summary.total")}</span>
          <span className="text-primary text-lg font-bold">
            {t("price", { price: total })}
          </span>
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isPending}
        >
          {t("summary.confirm")}
        </Button>
      </CardContent>
    </Card>
  );
}
