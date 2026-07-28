"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { browserClient } from "@/lib/supabase/browser";
import { fetchSeatMap } from "../api";

/** Collapse the burst of row events one lock produces into a single refetch. */
const DEBOUNCE_MS = 250;
/** How long the channel gets to reach SUBSCRIBED before we assume it will not. */
const SUBSCRIBE_TIMEOUT_MS = 5_000;
/** Fallback cadence when there is no live channel — the pre-Realtime behaviour. */
const POLL_MS = 15_000;
/**
 * Cadence kept even WITH a live channel. A hold does not expire by writing a
 * row — it lapses because `expires_at < now()` — so no event is ever emitted
 * for it and a purely event-driven map would show a lapsed hold as taken
 * indefinitely. This is the safe direction of wrong (a seat looks unavailable
 * slightly longer than it is; `lock_seats` revalidates server-side anyway), so
 * it earns a slow sweep rather than the 15s one.
 */
const LIVE_SAFETY_POLL_MS = 60_000;

export function useSeatMap(tripId: string) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);

  // Held in a ref so the debounce survives re-renders without restarting the
  // subscription effect.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!tripId) return;

    const client = browserClient();
    // Deterministic topic per trip. StrictMode mounts the effect twice in dev;
    // cleanup runs before the second mount, so the first channel is removed
    // before the replacement subscribes and only one is ever open.
    const channel = client.channel(`seat-map:${tripId}`);

    // Guards every async callback: `subscribe` and the debounce can both fire
    // after unmount, and setState/invalidate on a dead component is a leak.
    let cancelled = false;

    const invalidate = () => {
      if (cancelled) return;
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (cancelled) return;
        // Refetch — never patch the cache from the payload. A seat's status is
        // derived from booking_passengers, seat_lock_seats AND lock expiry, so
        // the row that changed is not enough to compute it. The payload is a
        // notification, not data.
        void queryClient.invalidateQueries({
          queryKey: queryKeys.trips.seats(tripId),
        });
      }, DEBOUNCE_MS);
    };

    // If the socket is blocked (corporate proxy, offline, DevTools request
    // blocking) `subscribe` may simply never call back. Without this the hook
    // would sit with live=false and poll — correct, but only by accident.
    const watchdog = setTimeout(() => {
      if (!cancelled) setLive(false);
    }, SUBSCRIBE_TIMEOUT_MS);

    channel
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          // Carries no passenger data — see the migration header for why the
          // source tables themselves are not published.
          table: "trip_seat_map_version",
          filter: `trip_id=eq.${tripId}`,
        },
        invalidate,
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          clearTimeout(watchdog);
          setLive(true);
          // The channel may have missed changes between the last fetch and the
          // socket opening; resync once now that it is live.
          invalidate();
          return;
        }
        // CHANNEL_ERROR | TIMED_OUT | CLOSED — drop to the 15s poll. Losing the
        // channel silently is the failure worth guarding against: a stale seat
        // map looks identical to a correct one.
        setLive(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      clearTimeout(debounceRef.current);
      setLive(false);
      void client.removeChannel(channel);
    };
  }, [tripId, queryClient]);

  return useQuery({
    queryKey: queryKeys.trips.seats(tripId),
    queryFn: () => fetchSeatMap(tripId),
    enabled: Boolean(tripId),
    refetchInterval: live ? LIVE_SAFETY_POLL_MS : POLL_MS,
    staleTime: 5_000,
  });
}
