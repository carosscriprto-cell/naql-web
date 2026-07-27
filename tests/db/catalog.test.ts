import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  publicClient,
  serviceClient,
  okData,
  type Envelope,
  type TripItem,
  type TripDetail,
} from "./helpers";
// The REAL frontend parsers. The point of the nullable-company cases below is
// that the shipped zod schemas accept what the RPC actually emits — asserting
// on hand-written types would only re-state what this file already believes.
// Relative, not "@/…": vitest.db.config.ts defines no path alias, and the only
// alias inside schemas.ts is a type-only import that esbuild erases.
import {
  tripDetailSchema,
  tripSearchListSchema,
} from "../../src/features/search/schemas";

// Seed fixtures (supabase/seed.sql).
const AMANA = "000000a1-0000-4000-8000-000000000001";
const TRIP_AMANA_DMS_ALP = "000000e1-0000-4000-8000-000000000001"; // published, tomorrow
const TRIP_DEPARTED = "000000e1-0000-4000-8000-000000000013";
const TRIP_DRAFT = "000000e1-0000-4000-8000-000000000015";
const DEMO_PASSENGER = "000000db-0000-4000-8000-000000000001";

const DMS_ALP_TOMORROW_IDS = [
  "000000e1-0000-4000-8000-000000000001",
  "000000e1-0000-4000-8000-000000000002",
  "000000e1-0000-4000-8000-000000000003",
  "000000e1-0000-4000-8000-000000000004",
];

const svc = serviceClient();

/** Damascus-local date (YYYY-MM-DD) of a UTC instant. Syria is UTC+3, no DST. */
function damascusDate(utc: Date): string {
  return new Date(utc.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

// Derived from the seed itself so it can't drift from the reset date.
let travelDate: string;

beforeAll(async () => {
  const { data, error } = await svc
    .from("trips")
    .select("departure_at")
    .eq("id", TRIP_AMANA_DMS_ALP)
    .single();
  if (error || !data) {
    throw new Error(
      `Seed missing trip ${TRIP_AMANA_DMS_ALP}: ${error?.message ?? "no row"}. Run db:reset.`,
    );
  }
  travelDate = damascusDate(new Date(data.departure_at));
});

async function search(from: string, to: string, date: string, passengers = 1) {
  const { data, error } = await publicClient().rpc("search_trips", {
    p_from_slug: from,
    p_to_slug: to,
    p_travel_date: date,
    p_passengers: passengers,
  });
  expect(error, `search_trips error: ${error?.message}`).toBeNull();
  return data as TripItem[];
}

describe("search_trips", () => {
  it("returns the seeded دمشق→حلب trips with full availability and the §2 shape", async () => {
    const rows = await search("damascus", "aleppo", travelDate);
    expect(Array.isArray(rows)).toBe(true);

    const ids = rows.map((t) => t.id);
    for (const id of DMS_ALP_TOMORROW_IDS) expect(ids).toContain(id);

    const trip = rows.find((t) => t.id === TRIP_AMANA_DMS_ALP)!;
    // No bookings/locks seeded on this trip → capacity 12×4 = 48.
    expect(trip.availableSeats).toBe(48);

    // Field-for-field vs tripSearchItemSchema.
    expect(trip.currency).toBe("SYP");
    expect(typeof trip.price).toBe("number");
    expect(["عادي", "VIP"]).toContain(trip.busType);
    expect(trip.company).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      logoUrl: expect.any(String),
      rating: expect.any(Number),
    });
    expect(trip.fromCity).toMatchObject({ id: expect.any(String), nameAr: "دمشق" });
    expect(trip.toCity).toMatchObject({ id: expect.any(String), nameAr: "حلب" });
    expect(trip.departureAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("drops a company's trips from the NEXT call once it is suspended", async () => {
    const before = (await search("damascus", "aleppo", travelDate)).map((t) => t.id);
    expect(before).toContain(TRIP_AMANA_DMS_ALP);

    await svc.from("companies").update({ status: "suspended" }).eq("id", AMANA);
    try {
      const after = (await search("damascus", "aleppo", travelDate)).map((t) => t.id);
      expect(after).not.toContain(TRIP_AMANA_DMS_ALP);
    } finally {
      await svc.from("companies").update({ status: "approved" }).eq("id", AMANA);
    }
  });

  it("places a 23:30 Damascus-local trip on the correct local date (boundary)", async () => {
    // Build a 23:30 Damascus trip 5 local-days out: 23:30 local = 20:30 UTC same date.
    const dam = new Date(Date.now() + 3 * 3_600_000);
    const localDay = new Date(
      Date.UTC(dam.getUTCFullYear(), dam.getUTCMonth(), dam.getUTCDate() + 5),
    );
    const dateStr = localDay.toISOString().slice(0, 10);
    const nextStr = new Date(localDay.getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const departureUtc = new Date(
      Date.UTC(localDay.getUTCFullYear(), localDay.getUTCMonth(), localDay.getUTCDate(), 20, 30),
    );

    const TEST_TRIP = "000000ee-0000-4000-8000-000000002330";
    await svc.from("trips").delete().eq("id", TEST_TRIP);
    const { error: insErr } = await svc.from("trips").insert({
      id: TEST_TRIP,
      company_id: AMANA,
      route_id: "000000e2-0000-4000-8000-000000000001", // دمشق→حلب
      bus_id: "000000b1-0000-4000-8000-000000000011",
      departure_at: departureUtc.toISOString(),
      arrival_at: new Date(departureUtc.getTime() + 5 * 3_600_000).toISOString(),
      price: 110000,
      status: "published",
    });
    expect(insErr, `insert test trip: ${insErr?.message}`).toBeNull();

    try {
      const onDay = (await search("damascus", "aleppo", dateStr)).map((t) => t.id);
      expect(onDay).toContain(TEST_TRIP); // 23:30 local stays on its local date

      const onNext = (await search("damascus", "aleppo", nextStr)).map((t) => t.id);
      expect(onNext).not.toContain(TEST_TRIP); // and not the following day
    } finally {
      await svc.from("trips").delete().eq("id", TEST_TRIP);
    }
  });

  it("an unexpired lock reduces availableSeats by exactly 1; an expired one does not", async () => {
    const LOCK = "000000ee-0000-4000-8000-000000000777";
    await svc.from("seat_lock_seats").delete().eq("lock_id", LOCK);
    await svc.from("seat_locks").delete().eq("id", LOCK);

    try {
      await svc.from("seat_locks").insert({
        id: LOCK,
        trip_id: TRIP_AMANA_DMS_ALP,
        owner_id: DEMO_PASSENGER,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      await svc.from("seat_lock_seats").insert({
        lock_id: LOCK,
        trip_id: TRIP_AMANA_DMS_ALP,
        seat_number: "7",
        gender: "male",
      });

      let trip = (await search("damascus", "aleppo", travelDate)).find(
        (t) => t.id === TRIP_AMANA_DMS_ALP,
      )!;
      expect(trip.availableSeats).toBe(47);

      // Expire it — no cleanup job, availability recovers on the next read.
      await svc
        .from("seat_locks")
        .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("id", LOCK);

      trip = (await search("damascus", "aleppo", travelDate)).find(
        (t) => t.id === TRIP_AMANA_DMS_ALP,
      )!;
      expect(trip.availableSeats).toBe(48);
    } finally {
      await svc.from("seat_lock_seats").delete().eq("lock_id", LOCK);
      await svc.from("seat_locks").delete().eq("id", LOCK);
    }
  });
});

describe("get_trip", () => {
  async function getTrip(id: string): Promise<Envelope<TripDetail>> {
    const { data, error } = await publicClient().rpc("get_trip", { p_trip_id: id });
    expect(error, `get_trip error: ${error?.message}`).toBeNull();
    return data as Envelope<TripDetail>;
  }

  it("returns ok for the departed trip (frontend renders the disabled CTA)", async () => {
    const trip = okData(await getTrip(TRIP_DEPARTED));
    expect(trip.id).toBe(TRIP_DEPARTED);
    expect(trip.cancellationPolicy).toBeTruthy();
    expect(trip.currency).toBe("SYP");
  });

  it("returns NOT_FOUND for a draft trip", async () => {
    const res = await getTrip(TRIP_DRAFT);
    if (res.ok) throw new Error("expected NOT_FOUND");
    expect(res.error.code).toBe("NOT_FOUND");
  });

  it("returns NOT_FOUND for a missing trip id", async () => {
    const res = await getTrip("00000000-0000-4000-8000-0000000fffff");
    if (res.ok) throw new Error("expected NOT_FOUND");
    expect(res.error.code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// Nullable company fields + p_passengers (BACKEND_V1 §2).
//
// SAFETY: every row here is THROWAWAY, created under a reserved uuid prefix and
// dropped in afterAll. No seeded row is inserted, updated or deleted.
//
// The predecessor of this suite NULLed logo_url/rating on the SEEDED الأمانة
// company and restored it in a finally. If that process died in between, DEV
// was left with a permanently logo-less, rating-less company and the next
// manual QA round chased a phantom bug. A private fixture cannot do that: the
// worst a crash leaves behind is an orphan block that no seeded flow reads,
// greppable by its prefix and safe to delete by hand:
//
//   delete from trips     where id::text like '000000ee-0000-4000-8000-0000cafe%';
//   delete from buses     where id::text like '000000ee-0000-4000-8000-0000cafe%';
//   delete from routes    where id::text like '000000ee-0000-4000-8000-0000cafe%';
//   delete from companies where id::text like '000000ee-0000-4000-8000-0000cafe%';
// ===========================================================================
const SCRATCH = "000000ee-0000-4000-8000-0000cafe";
const NULL_COMPANY = `${SCRATCH}0001`; // approved, logo_url null, rating null
const SCRATCH_ROUTE = `${SCRATCH}0002`; // حلب→حمص — not a seeded pair
const BUS_STD = `${SCRATCH}0003`; // 12×4 = 48 seats
const BUS_SMALL = `${SCRATCH}0004`; // 2×2 = 4 seats, for the passengers threshold
const TRIP_DEGRADED = `${SCRATCH}0005`; // NULL_COMPANY on BUS_STD  → 48 seats
const TRIP_INTACT = `${SCRATCH}0006`; // seeded الأمانة on BUS_SMALL → 4 seats

const ALEPPO = "000000c1-0000-4000-8000-000000000002";
const HOMS = "000000c1-0000-4000-8000-000000000003";
const STD_LAYOUT = { rows: 12, cols: 4, aisleAfterCol: 2 };

/** Delete the fixture in FK order. Tolerant — used as both pre-clean and teardown. */
async function dropScratch() {
  await svc.from("trips").delete().in("id", [TRIP_DEGRADED, TRIP_INTACT]);
  await svc.from("buses").delete().in("id", [BUS_STD, BUS_SMALL]);
  await svc.from("routes").delete().eq("id", SCRATCH_ROUTE);
  await svc.from("companies").delete().eq("id", NULL_COMPANY);
}

describe("nullable company.logoUrl / company.rating + p_passengers", () => {
  // Damascus-local day of the scratch trips, and the date the search uses.
  let scratchDate: string;

  beforeAll(async () => {
    // A previous crashed run may have left the block behind.
    await dropScratch();

    const dam = new Date(Date.now() + 3 * 3_600_000);
    // +6 local days, 10:00 Damascus = 07:00 UTC — comfortably future, and clear
    // of the 23:30 boundary fixture above (+5 days, different route).
    const departureUtc = new Date(
      Date.UTC(dam.getUTCFullYear(), dam.getUTCMonth(), dam.getUTCDate() + 6, 7, 0),
    );
    scratchDate = damascusDate(departureUtc);
    const arrivalUtc = new Date(departureUtc.getTime() + 3 * 3_600_000);

    const arrange = async (label: string, run: PromiseLike<{ error: unknown }>) => {
      const { error } = await run;
      if (error) {
        throw new Error(
          `arrange ${label}: ${(error as { message?: string }).message ?? String(error)}`,
        );
      }
    };

    // An approved company with NO logo and NO rating — both columns are
    // nullable, so this is a legitimate company, not corrupt data.
    await arrange(
      "company",
      svc.from("companies").insert({
        id: NULL_COMPANY,
        name: "شركة بلا شعار",
        logo_url: null,
        rating: null,
        status: "approved",
        commission_rate: 0.25,
      }),
    );

    await arrange(
      "route",
      svc.from("routes").insert({
        id: SCRATCH_ROUTE,
        from_city_id: ALEPPO,
        to_city_id: HOMS,
        default_duration_min: 180,
      }),
    );

    await arrange(
      "buses",
      svc.from("buses").insert([
        {
          id: BUS_STD,
          company_id: NULL_COMPANY,
          plate_number: "SCRATCH-STD",
          bus_type: "VIP",
          layout: STD_LAYOUT,
        },
        {
          // Owned by the seeded company that operates TRIP_INTACT. Four seats,
          // so a party of 5 drops this trip and only this trip.
          id: BUS_SMALL,
          company_id: AMANA,
          plate_number: "SCRATCH-SML",
          bus_type: "عادي",
          layout: { rows: 2, cols: 2, aisleAfterCol: 1 },
        },
      ]),
    );

    await arrange(
      "trips",
      svc.from("trips").insert([
        {
          id: TRIP_DEGRADED,
          company_id: NULL_COMPANY,
          route_id: SCRATCH_ROUTE,
          bus_id: BUS_STD,
          departure_at: departureUtc.toISOString(),
          arrival_at: arrivalUtc.toISOString(),
          price: 70000,
          status: "published",
        },
        {
          id: TRIP_INTACT,
          company_id: AMANA,
          route_id: SCRATCH_ROUTE,
          bus_id: BUS_SMALL,
          departure_at: departureUtc.toISOString(),
          arrival_at: arrivalUtc.toISOString(),
          price: 65000,
          status: "published",
        },
      ]),
    );
  });

  // Runs even when every assertion above failed.
  afterAll(dropScratch);

  it("a null-logo, null-rating company is ONE degraded item — the whole list still parses", async () => {
    const rows = await search("aleppo", "homs", scratchDate);

    // The frontend parser is the assertion: a throw here is /search rendering
    // its error state, and it would take every sibling card down with it.
    const parsed = tripSearchListSchema.parse(rows);
    expect(parsed).toHaveLength(2);

    const degraded = parsed.find((t) => t.id === TRIP_DEGRADED);
    expect(degraded, "the degraded trip must be RETURNED, not filtered out").toBeDefined();
    expect(degraded!.company.logoUrl).toBeNull();
    expect(degraded!.company.rating).toBeNull();
    // …and the rest of that item is intact — only the two nullable fields are null.
    expect(degraded!.company.name).toBe("شركة بلا شعار");
    expect(degraded!.availableSeats).toBe(48);
    expect(degraded!.currency).toBe("SYP");
    expect(degraded!.busType).toBe("VIP");

    // The sibling card is untouched by its neighbour's missing fields.
    const intact = parsed.find((t) => t.id === TRIP_INTACT)!;
    expect(intact.company.logoUrl).toEqual(expect.any(String));
    expect(intact.company.rating).toEqual(expect.any(Number));
  });

  it("get_trip on that trip parses with both fields null", async () => {
    const { data, error } = await publicClient().rpc("get_trip", {
      p_trip_id: TRIP_DEGRADED,
    });
    expect(error, `get_trip error: ${error?.message}`).toBeNull();

    const trip = tripDetailSchema.parse(okData(data as Envelope<TripDetail>));
    expect(trip.id).toBe(TRIP_DEGRADED);
    expect(trip.company.logoUrl).toBeNull();
    expect(trip.company.rating).toBeNull();
    expect(trip.cancellationPolicy).toBeTruthy();
  });

  // T-PAS1-8, the half the state report flagged as uncovered: the RPC really
  // does filter on p_passengers. Pinning it to 1 in the client (the bug this
  // closes) made the whole argument dead code.
  it("p_passengers drops trips whose availableSeats is below it (T-PAS1-8)", async () => {
    const forOne = (await search("aleppo", "homs", scratchDate, 1)).map((t) => t.id);
    expect(forOne).toEqual(expect.arrayContaining([TRIP_DEGRADED, TRIP_INTACT]));

    // 4 seats < 5 → the small-bus trip drops; the 48-seat one stays.
    const forFive = (await search("aleppo", "homs", scratchDate, 5)).map((t) => t.id);
    expect(forFive).toContain(TRIP_DEGRADED);
    expect(forFive).not.toContain(TRIP_INTACT);

    // Larger than any bus on this route → nothing survives.
    expect(await search("aleppo", "homs", scratchDate, 49)).toEqual([]);
  });
});
