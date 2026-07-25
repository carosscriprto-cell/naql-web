"use client";

import { UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { SeatMap as SeatMapModel } from "../schemas";
import { useBookingStore } from "../store";
import { GenderIcon } from "./gender-icon";

export function SeatMap({
  map,
  maxSeats,
  conflictSeats = [],
}: {
  map: SeatMapModel;
  maxSeats: number;
  conflictSeats?: string[];
}) {
  const t = useTranslations("seatMap");
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const toggleSeat = useBookingStore((s) => s.toggleSeat);
  const { layout, seats } = map;
  const selected = new Set(selectedSeats.map((s) => s.seatNumber));
  const conflicts = new Set(conflictSeats);

  // Aisle = one narrow empty track after `aisleAfterCol`; grid flows RTL.
  const gridTemplateColumns = `repeat(${layout.aisleAfterCol}, minmax(0, 1fr)) 0.6fr repeat(${layout.cols - layout.aisleAfterCol}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <span className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs">
          <UserRoundIcon className="size-3.5" aria-hidden />
          {t("driver")}
        </span>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns }}>
        {seats.map((seat) => {
          const isSelected = selected.has(seat.number);
          const occupied = seat.status === "locked" || seat.status === "booked";
          const gridColumn =
            seat.col < layout.aisleAfterCol ? seat.col + 1 : seat.col + 2;
          return (
            <button
              key={seat.number}
              type="button"
              disabled={occupied}
              onClick={() => toggleSeat(seat.number, maxSeats)}
              aria-label={t("seat", { number: seat.number })}
              aria-pressed={isSelected}
              style={{ gridColumn, gridRow: seat.row + 1 }}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl border text-sm font-medium transition-colors",
                seat.status === "available" &&
                  !isSelected &&
                  "border-border hover:border-primary",
                isSelected && "border-primary bg-primary text-primary-foreground",
                seat.status === "locked" &&
                  "bg-muted text-muted-foreground border-transparent",
                seat.status === "booked" &&
                  "bg-foreground/80 text-background border-transparent",
                occupied && "cursor-not-allowed",
                conflicts.has(seat.number) &&
                  "ring-destructive animate-pulse ring-2 ring-offset-2",
              )}
            >
              {occupied && seat.gender ? (
                <GenderIcon gender={seat.gender} className="size-4" />
              ) : (
                seat.number
              )}
            </button>
          );
        })}
      </div>

      <SeatLegend />
    </div>
  );
}

function SeatLegend() {
  const t = useTranslations("seatMap");
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
      <LegendSwatch
        className="bg-transparent"
        label={t("legend.available")}
      />
      <LegendSwatch
        className="bg-primary border-primary"
        label={t("legend.selected")}
      />
      <div className="flex items-center gap-1.5">
        <GenderIcon gender="male" className="size-4" />
        {t("legend.male")}
      </div>
      <div className="flex items-center gap-1.5">
        <GenderIcon gender="female" className="size-4" />
        {t("legend.female")}
      </div>
    </div>
  );
}

function LegendSwatch({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("size-4 rounded-md border", className)} />
      {label}
    </div>
  );
}
