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
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const passengers = Math.max(1, Number(searchParams.get("passengers")) || 1);
  const { data: map, isPending, isError } = useSeatMap(tripId);
  const clearSelection = useBookingStore((s) => s.clearSelection);
  const dropSeats = useBookingStore((s) => s.dropSeats);
  const setLock = useBookingStore((s) => s.setLock);
  const [conflictSeats, setConflictSeats] = useState<string[]>([]);

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
    onError: (error) => {
      const conflict =
        error instanceof ApiError &&
        (error.code === "SEAT_ALREADY_LOCKED" ||
          error.code === "SEAT_ALREADY_BOOKED");
      if (conflict) {
        const seats = Array.isArray((error as ApiError).details?.seats)
          ? ((error as ApiError).details!.seats as string[])
          : [];
        dropSeats(seats);
        setConflictSeats(seats);
        toast.error(t("conflict"));
        queryClient.invalidateQueries({
          queryKey: queryKeys.trips.seats(tripId),
        });
      } else {
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
      <SelectionBar
        pricePerSeat={pricePerSeat}
        passengers={passengers}
        isPending={lockMutation.isPending}
        onContinue={() => lockMutation.mutate()}
      />
    </div>
  );
}
