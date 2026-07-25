"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Gender } from "../schemas";
import { useBookingStore } from "../store";

const GENDERS: Gender[] = ["male", "female"];

export function SelectionBar({
  pricePerSeat,
  passengers,
  isPending,
  onContinue,
}: {
  pricePerSeat: number;
  passengers: number;
  isPending: boolean;
  onContinue: () => void;
}) {
  const t = useTranslations("seatMap");
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const setSeatGender = useBookingStore((s) => s.setSeatGender);
  const toggleSeat = useBookingStore((s) => s.toggleSeat);
  const total = pricePerSeat * selectedSeats.length;
  const complete = selectedSeats.length === passengers;

  return (
    <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 px-4 py-3">
        {selectedSeats.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {selectedSeats.map((seat) => (
              <div
                key={seat.seatNumber}
                className="flex shrink-0 items-center gap-2 rounded-full border py-1 pe-1 ps-3"
              >
                <span className="text-sm font-medium">
                  {t("seat", { number: seat.seatNumber })}
                </span>
                <div className="bg-muted flex rounded-full p-0.5 text-xs">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setSeatGender(seat.seatNumber, g)}
                      aria-pressed={seat.gender === g}
                      className={cn(
                        "rounded-full px-2 py-0.5 transition-colors",
                        seat.gender === g
                          ? "bg-background font-medium shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {t(g)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => toggleSeat(seat.seatNumber, passengers)}
                  aria-label={t("remove")}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  <XIcon className="size-4" aria-hidden />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t("selectHint", { count: passengers })}
          </p>
        )}

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs">{t("total")}</p>
            <p className="text-primary text-lg font-bold">
              {t("totalPrice", { price: total })}
            </p>
          </div>
          <Button
            size="lg"
            disabled={!complete || isPending}
            onClick={onContinue}
          >
            {t("continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
