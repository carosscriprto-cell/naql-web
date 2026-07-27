import { describe, it, expect, beforeAll } from "vitest";
import {
  publicClient,
  serviceClient,
  okData,
  type Envelope,
  type TripItem,
  type TripDetail,
} from "./helpers";

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
