"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-error";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { lockSeats } from "../api";
import { useSeatMap } from "../hooks/use-seat-map";
import { useBookingStore } from "../store";
import { SeatMap } from "./seat-map";
import { SelectionBar } from "./selection-bar";

export function SeatSelection({
  tripId,
  pricePerSeat,
}: {
  tripId: string;
  pricePerSeat: number;
}) {
  const t = useTranslations("seatMap");
  // Reused, not re-worded: the departed state says exactly what the trip-detail
  // CTA says, so it reads the SAME key rather than a second string that could
  // drift away from it.
  const tTrip = useTranslations("tripDetail");
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const passengers = Math.max(1, Number(searchParams.get("passengers")) || 1);
  const { data: map, isPending, isError } = useSeatMap(tripId);
  const clearSelection = useBookingStore((s) => s.clearSelection);
  const dropSeats = useBookingStore((s) => s.dropSeats);
  const setLock = useBookingStore((s) => s.setLock);
  const [conflictSeats, setConflictSeats] = useState<string[]>([]);
  // Set by TRIP_DEPARTED. Sticky: a trip does not un-depart, so once the server
  // has said so the CTA stays down for the rest of the visit.
  const [departed, setDeparted] = useState(false);

  // Fresh selection per trip visit.
  useEffect(() => {
    clearSelection();
  }, [tripId, clearSelection]);

  // Only a *refetch* (not the first load) can newly take a selected seat, so we
  // skip the initial map and compare against the live selection on each update.
  const seenMap = useRef(false);
  useEffect(() => {
    if (!map) return;
    if (!seenMap.current) {
      seenMap.current = true;
      return;
    }
    const taken = new Set(
      map.seats.filter((s) => s.status !== "available").map((s) => s.number),
    );
    const conflicts = useBookingStore
      .getState()
      .selectedSeats.filter((s) => taken.has(s.seatNumber))
      .map((s) => s.seatNumber);
    if (conflicts.length > 0) {
      dropSeats(conflicts);
      toast(t("seatTaken", { seats: conflicts.join("، ") }));
    }
  }, [map, dropSeats, t]);

  const lockMutation = useMutation({
    mutationFn: () => lockSeats(tripId, useBookingStore.getState().selectedSeats),
    onSuccess: (res) => {
      setLock(res.lockId, res.expiresAt, tripId);
      router.push("/booking/checkout");
    },
    // Every branch keys on ApiError.code only — never message text, never an
    // HTTP status (CLAUDE.md). The default arm is the T-RES-2 fallback and
    // stays: an unknown code must still surface as something.
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : "";
      const details = error instanceof ApiError ? error.details : undefined;

      switch (code) {
        // Seats taken between the map render and the lock. Recoverable in
        // place: drop them, flash them, refetch, stay on the page.
        case "SEAT_ALREADY_LOCKED":
        case "SEAT_ALREADY_BOOKED": {
          const seats = Array.isArray(details?.seats)
            ? (details.seats as string[])
            : [];
          dropSeats(seats);
          setConflictSeats(seats);
          toast.error(t("conflict"));
          queryClient.invalidateQueries({
            queryKey: queryKeys.trips.seats(tripId),
          });
          break;
        }

        // The bus left while the page was open. Terminal for this trip — there
        // is nothing to retry, so the CTA goes down rather than inviting another
        // tap that will fail identically.
        case "TRIP_DEPARTED": {
          setDeparted(true);
          clearSelection();
          toast.error(tTrip("ctaDeparted"));
          break;
        }

        // The trip stopped being published, or its company was suspended, while
        // the page was open. This page is now a dead end, so the only useful
        // destination is search. `replace`, not `push`: Back must not return to
        // a trip that no longer exists.
        case "NOT_FOUND": {
          toast.error(t("tripUnavailable"));
          router.replace("/search");
          break;
        }

        // A seat number outside the layout, or an invalid gender — the request
        // was malformed, not the trip. Keep the flow alive: refetch so the map
        // is authoritative again and let the user pick afresh.
        case "VALIDATION_ERROR": {
          clearSelection();
          toast.error(t("invalidSelection"));
          queryClient.invalidateQueries({
            queryKey: queryKeys.trips.seats(tripId),
          });
          break;
        }

        // ensureSession() could not mint an anonymous identity — anonymous
        // sign-ins switched off, or the per-IP hourly cap reached. NOT a login
        // problem: there is no passenger login in v1 (BACKEND_V1 §1), so the
        // copy must not imply an account is needed. Retrying is the whole fix.
        case "UNAUTHORIZED": {
          toast.error(t("sessionFailed"));
          break;
        }

        default:
          toast.error(t("genericError"));
      }
    },
  });

  // Clear the destructive ring shortly after the conflict flash.
  useEffect(() => {
    if (conflictSeats.length === 0) return;
    const id = window.setTimeout(() => setConflictSeats([]), 1500);
    return () => window.clearTimeout(id);
  }, [conflictSeats]);

  if (isPending) return <Skeleton className="h-96 w-full rounded-3xl" />;
  if (isError) {
    return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <SeatMap map={map} maxSeats={passengers} conflictSeats={conflictSeats} />
      {departed && (
        <p className="text-destructive text-center text-sm font-medium">
          {tTrip("ctaDeparted")}
        </p>
      )}
      <SelectionBar
        pricePerSeat={pricePerSeat}
        passengers={passengers}
        // SelectionBar's `isPending` feeds nothing but the CTA's `disabled`, so
        // it is the existing seam for "this button must not be pressable". A
        // dedicated `disabled` prop would read better, but it lives in
        // selection-bar.tsx, which this task does not touch.
        isPending={lockMutation.isPending || departed}
        onContinue={() => lockMutation.mutate()}
      />
    </div>
  );
}
