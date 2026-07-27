import { z } from "zod";

import { ApiError } from "@/lib/api-error";
import { callRpc, callRpcBare } from "@/lib/rpc";
import { browserClient } from "@/lib/supabase/browser";
import {
  citySchema,
  tripDetailSchema,
  tripSearchListSchema,
  type City,
  type TripDetail,
  type TripSearchItem,
} from "./schemas";

// Catalog reads go straight to Supabase (BACKEND_V1 §2). They are public — the
// browser client is used for its session, not for authorization: cities is
// readable by anon, and both RPCs are GRANTed to anon + authenticated, so these
// work signed-in or not. Every response is still zod-parsed against the same
// schemas the MSW era used.

/**
 * PostgREST table reads are **bare and snake_case** — no §0 envelope, no
 * camelCase aliasing (that only happens inside the RPCs' json_build_object).
 * The rename to the contract's camelCase shape therefore lives here, at the
 * transport edge, so `citySchema` stays the domain shape the UI knows.
 */
export async function fetchCities(): Promise<City[]> {
  const { data, error } = await browserClient()
    .from("cities")
    .select("id,name_ar,name_en,slug");

  // A PostgREST `error` is a transport failure, same meaning as in lib/rpc.ts:
  // no rows came back at all. Table reads have no domain failure mode.
  if (error) {
    throw new ApiError(
      "NETWORK_ERROR",
      `cities read failed: ${error.message}`,
      {
        table: "cities",
        pgCode: error.code,
        details: error.details,
        hint: error.hint,
      },
    );
  }

  return z.array(citySchema).parse(
    data.map((row) => ({
      id: row.id,
      nameAr: row.name_ar,
      nameEn: row.name_en,
      slug: row.slug,
    })),
  );
}

export type TripSearchParams = {
  from: string;
  to: string;
  date: string;
  /** Normalised by `parsePassengers()` in hooks/use-search-trips.ts, never raw. */
  passengers: number;
};

/**
 * `search_trips` is BARE (BACKEND_V1 §2): a list read for one route+date has no
 * domain failure mode, so it returns the array directly — no envelope, no
 * `items`, no pagination meta. Hence callRpcBare, which zod-parses `data` as-is.
 *
 * `p_passengers` drops trips whose `availableSeats` is below it, server-side.
 */
export async function fetchTrips(
  params: TripSearchParams,
): Promise<TripSearchItem[]> {
  return callRpcBare(
    browserClient(),
    "search_trips",
    {
      p_from_slug: params.from,
      p_to_slug: params.to,
      p_travel_date: params.date,
      p_passengers: params.passengers,
    },
    tripSearchListSchema,
  );
}

/**
 * `get_trip` IS enveloped — it has a real failure mode. A missing, draft, or
 * suspended-company trip comes back as `{ ok: false, error: { code:
 * "NOT_FOUND" } }` at HTTP 200; `unwrap()` inside callRpc turns that into an
 * `ApiError` whose `code` trip-detail.tsx already keys on.
 */
export async function getTrip(id: string): Promise<TripDetail> {
  return callRpc(
    browserClient(),
    "get_trip",
    { p_trip_id: id },
    tripDetailSchema,
  );
}
