import Link from "next/link";
import { differenceInMinutes, format } from "date-fns";
import { ar } from "date-fns/locale";
import { BusFrontIcon, StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { TripSearchItem } from "../schemas";

export function TripCard({
  trip,
  passengers,
}: {
  trip: TripSearchItem;
  passengers: string;
}) {
  const t = useTranslations("searchPage");
  const departure = new Date(trip.departureAt);
  const arrival = new Date(trip.arrivalAt);
  const totalMinutes = differenceInMinutes(arrival, departure);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const duration = [
    hours > 0 ? t("durationHours", { hours }) : null,
    minutes > 0 ? t("durationMinutes", { minutes }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-full">
              <BusFrontIcon className="size-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">{trip.company.name}</p>
              {/* rating is nullable (§2) — an unrated company shows no rating
                  row at all, never a 0 or a dash. */}
              {trip.company.rating !== null && (
                <p className="text-muted-foreground flex items-center gap-1 text-xs">
                  <StarIcon
                    className="size-3 fill-amber-400 text-amber-400"
                    aria-hidden
                  />
                  {trip.company.rating}
                </p>
              )}
            </div>
          </div>
          <Badge variant={trip.busType === "VIP" ? "default" : "outline"}>
            {trip.busType}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-lg leading-tight font-bold">
              {format(departure, "h:mm a", { locale: ar })}
            </p>
            <p className="text-muted-foreground text-xs">
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
            <p className="text-lg leading-tight font-bold">
              {format(arrival, "h:mm a", { locale: ar })}
            </p>
            <p className="text-muted-foreground text-xs">
              {trip.toCity.nameAr}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div>
            <p className="text-primary text-lg font-bold">
              {t("price", { price: trip.price })}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("seatsAvailable", { count: trip.availableSeats })}
            </p>
          </div>
          <Button
            render={
              <Link href={`/trips/${trip.id}?passengers=${passengers}`} />
            }
          >
            {t("selectSeats")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
