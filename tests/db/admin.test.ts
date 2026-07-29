import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  pooledAnonClient,
  publicClient,
  serviceClient,
  okData,
  type Envelope,
  type SupabaseClient,
} from "./helpers";

// B9 / M6 — admin RPCs (BACKEND_V1 §6). Covers the two P0 cases from
// docs/V1_TEST_PLAN.md that had no implementation to run against:
//
//   T-ADM-SEC  — operator / passenger / no-session against every admin RPC.
//   T-ADM1-2   — commissionRate 0.19 / 0.36 / 0.30, plus the regression that
//                matters more than the bounds: changing a company's rate must
//                not move one pound of already-booked money, in EITHER report
//                (operator_summary and commissions_by_month read the snapshot
//                on bookings.commission_rate, never companies.commission_rate).
//
// Plus T-ADM2-1 (delete guards) and the ADM-1 suspension case.
//
// FIXTURE. A private block under a reserved uuid prefix, torn down in afterAll.
// It carries its OWN cities, routes and company, so the suspension case can
// suspend a real approved company without hiding a seeded one from every other
// suite. The one seeded row it touches is the commission_rate of the operator's
// company — unavoidable, because operator_summary authorises on that session's
// company_id claim and no password can be minted for a scratch company through
// PostgREST. The original rate is read in beforeAll and restored in afterAll.
//
// A crashed run leaves a greppable orphan, hand-cleanable with:
//   delete from booking_passengers where trip_id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from bookings  where id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from trips     where id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from buses     where id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from companies where id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from routes    where id::text like '000000ad-0000-4000-8000-0000adc0%';
//   delete from cities    where id::text like '000000ad-0000-4000-8000-0000adc0%';

const D = "000000ad-0000-4000-8000-0000adc0";

const CITY_X = `${D}0001`; // endpoint of ROUTE_XY → blocked by future trips
const CITY_Y = `${D}0002`; // endpoint of ROUTE_XY and ROUTE_YM
const CITY_LONE = `${D}0003`; // no routes at all → the deletable case
const CITY_M = `${D}0004`; // one route, no trips → referenced_by_routes

const ROUTE_XY = `${D}0010`; // carries both published trips
const ROUTE_YX = `${D}0011`; // no trips → the deletable case
const ROUTE_YM = `${D}0012`; // no trips, exists only to keep CITY_M referenced

const COMPANY_S = `${D}0020`; // scratch company — the suspension target
const BUS_S = `${D}0030`;
const BUS_A = `${D}0031`; // belongs to the seeded operator's company

const TRIP_S = `${D}0040`; // COMPANY_S, +6d  — suspension / search visibility
const TRIP_A = `${D}0041`; // COMPANY_A, +200d — the commission fixture
const BOOKING_A = `${D}0050`; // 2 seats, 100000, snapshot rate 0.10

const SCRATCH_CITY_SLUGS = { x: "adm-scratch-x", y: "adm-scratch-y" };

// TRIP_A sits ~200 days out ON PURPOSE. supabase/seed.sql only creates trips up
// to day +14, so that month contains nothing but this fixture — which is what
// lets commissions_by_month be asserted as an EXACT object rather than a
// before/after diff. A near-term month would fold seeded bookings into the
// totals and the assertion would only be able to say "unchanged", missing a
// function that reads the company's current rate for a company with no other
// bookings.
const TRIP_A_DAYS_OUT = 200;

const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0 O 1 I (§4)
const RUN = Array.from(
  { length: 4 },
  () => PNR_ALPHABET[Math.floor(Math.random() * PNR_ALPHABET.length)],
).join("");
const PNR_A = `AD${RUN}`;

const DEMO_PASSENGER = "000000db-0000-4000-8000-000000000001";

const svc = serviceClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Set it in .env.test.`);
  return value;
}

/** Claims as the RPCs themselves read them — straight out of the access token. */
function claimsOf(accessToken: string): { user_role?: string; company_id?: string } {
  return JSON.parse(
    Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"),
  ) as { user_role?: string; company_id?: string };
}

async function signIn(email: string, password: string): Promise<{
  client: SupabaseClient;
  claims: { user_role?: string; company_id?: string };
}> {
  const client = publicClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  const token = data.session?.access_token;
  if (!token) throw new Error(`no session for ${email}`);
  return { client, claims: claimsOf(token) };
}

let admin: SupabaseClient;
let operator: SupabaseClient;
let passenger: SupabaseClient;

let COMPANY_A: string; // the seeded operator's company
let COMPANY_A_ORIGINAL_RATE: number;

let tripADate: string; // Damascus-local date of TRIP_A
let tripAMonth: string; // YYYY-MM of the same
let tripSDate: string; // Damascus-local date of TRIP_S

/** Damascus-local date (YYYY-MM-DD) of a UTC instant. Syria is UTC+3, no DST. */
function damascusDate(utc: Date): string {
  return new Date(utc.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** 10:00 Damascus, `days` local-days out (= 07:00 UTC). */
function departureUtc(days: number): Date {
  const dam = new Date(Date.now() + 3 * 3_600_000);
  return new Date(
    Date.UTC(dam.getUTCFullYear(), dam.getUTCMonth(), dam.getUTCDate() + days, 7, 0),
  );
}

async function arrange(label: string, run: PromiseLike<{ error: unknown }>) {
  const { error } = await run;
  if (error) {
    throw new Error(
      `arrange ${label}: ${(error as { message?: string }).message ?? String(error)}`,
    );
  }
}

async function dropFixture() {
  await svc.from("booking_passengers").delete().eq("booking_id", BOOKING_A);
  await svc.from("bookings").delete().eq("id", BOOKING_A);
  await svc.from("seat_locks").delete().in("trip_id", [TRIP_S, TRIP_A]);
  await svc.from("trips").delete().in("id", [TRIP_S, TRIP_A]);
  await svc.from("buses").delete().in("id", [BUS_S, BUS_A]);
  await svc.from("companies").delete().eq("id", COMPANY_S);
  await svc.from("routes").delete().in("id", [ROUTE_XY, ROUTE_YX, ROUTE_YM]);
  await svc.from("cities").delete().in("id", [CITY_X, CITY_Y, CITY_LONE, CITY_M]);
}

beforeAll(async () => {
  await dropFixture(); // a previous crashed run may have left the block behind

  const a = await signIn(required("TEST_ADMIN_EMAIL"), required("TEST_ADMIN_PASSWORD"));
  if (a.claims.user_role !== "admin") {
    throw new Error(
      `TEST_ADMIN_EMAIL is not an ADMIN account (user_role=${a.claims.user_role ?? "?"}). ` +
        "supabase/seed.sql seeds admin@naql.dev.",
    );
  }
  // §6 admins are global: the hook removes company_id when profiles.company_id
  // is null, and every function below relies on that being absent, not empty.
  expect(a.claims.company_id, "an admin must carry NO company_id claim").toBeUndefined();
  admin = a.client;

  const o = await signIn(
    required("TEST_OPERATOR_EMAIL"),
    required("TEST_OPERATOR_PASSWORD"),
  );
  if (o.claims.user_role !== "operator" || !o.claims.company_id) {
    throw new Error(
      `TEST_OPERATOR_EMAIL is not an OPERATOR account (user_role=${o.claims.user_role ?? "?"}).`,
    );
  }
  operator = o.client;
  COMPANY_A = o.claims.company_id;

  // A dedicated pooled slot: a fresh signInAnonymously() here would burn one of
  // the hosted project's ~30/hour anonymous sign-ins for nothing.
  passenger = await pooledAnonClient(20);

  const { data: companyA, error: rateErr } = await svc
    .from("companies")
    .select("commission_rate")
    .eq("id", COMPANY_A)
    .single();
  if (rateErr) throw new Error(`reading COMPANY_A rate: ${rateErr.message}`);
  COMPANY_A_ORIGINAL_RATE = Number(companyA.commission_rate);

  const depS = departureUtc(6);
  const depA = departureUtc(TRIP_A_DAYS_OUT);
  tripSDate = damascusDate(depS);
  tripADate = damascusDate(depA);
  tripAMonth = tripADate.slice(0, 7);
  const plus3h = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString();

  await arrange(
    "cities",
    svc.from("cities").insert([
      { id: CITY_X, name_ar: "مدينة اختبار س", name_en: "Admin Scratch X", slug: SCRATCH_CITY_SLUGS.x },
      { id: CITY_Y, name_ar: "مدينة اختبار ص", name_en: "Admin Scratch Y", slug: SCRATCH_CITY_SLUGS.y },
      { id: CITY_LONE, name_ar: "مدينة بلا خطوط", name_en: "Admin Scratch Lone", slug: "adm-scratch-lone" },
      { id: CITY_M, name_ar: "مدينة بخط واحد", name_en: "Admin Scratch M", slug: "adm-scratch-m" },
    ]),
  );

  await arrange(
    "routes",
    svc.from("routes").insert([
      { id: ROUTE_XY, from_city_id: CITY_X, to_city_id: CITY_Y, default_duration_min: 180 },
      { id: ROUTE_YX, from_city_id: CITY_Y, to_city_id: CITY_X, default_duration_min: 180 },
      { id: ROUTE_YM, from_city_id: CITY_Y, to_city_id: CITY_M, default_duration_min: 90 },
    ]),
  );

  await arrange(
    "company",
    svc.from("companies").insert({
      id: COMPANY_S,
      name: "شركة اختبار الإدارة",
      status: "approved",
      commission_rate: 0.25,
    }),
  );

  await arrange(
    "buses",
    svc.from("buses").insert([
      { id: BUS_S, company_id: COMPANY_S, plate_number: "ADMSCRATCH-S", bus_type: "VIP", layout: { rows: 12, cols: 4, aisleAfterCol: 2 } },
      { id: BUS_A, company_id: COMPANY_A, plate_number: "ADMSCRATCH-A", bus_type: "VIP", layout: { rows: 12, cols: 4, aisleAfterCol: 2 } },
    ]),
  );

  await arrange(
    "trips",
    svc.from("trips").insert([
      {
        id: TRIP_S, company_id: COMPANY_S, route_id: ROUTE_XY, bus_id: BUS_S,
        departure_at: depS.toISOString(), arrival_at: plus3h(depS),
        price: 50000, status: "published",
      },
      {
        id: TRIP_A, company_id: COMPANY_A, route_id: ROUTE_XY, bus_id: BUS_A,
        departure_at: depA.toISOString(), arrival_at: plus3h(depA),
        price: 50000, status: "published",
      },
    ]),
  );

  // The snapshotted rate is 0.10 — DELIBERATELY outside the 0.20–0.35 range a
  // company may hold, so no value set_commission_rate could ever write can
  // coincide with it. That is what makes "reads the snapshot" and "reads the
  // company" distinguishable no matter which rate the test moves COMPANY_A to.
  await arrange(
    "booking",
    svc.from("bookings").insert({
      id: BOOKING_A, trip_id: TRIP_A, user_id: DEMO_PASSENGER, pnr: PNR_A,
      status: "confirmed", payment_method: "cash", total_price: 100000,
      commission_rate: 0.1, idempotency_key: `${D}0060`,
    }),
  );

  await arrange(
    "passengers",
    svc.from("booking_passengers").insert([
      { booking_id: BOOKING_A, trip_id: TRIP_A, seat_number: "1", full_name: "سمير حسن", phone: "+963900000011", gender: "male", active: true },
      { booking_id: BOOKING_A, trip_id: TRIP_A, seat_number: "2", full_name: "ليلى مراد", phone: "+963900000011", gender: "female", active: true },
    ]),
  );
});

afterAll(async () => {
  // Restore the one seeded value this suite moves, whatever happened above.
  if (COMPANY_A && Number.isFinite(COMPANY_A_ORIGINAL_RATE)) {
    await svc
      .from("companies")
      .update({ commission_rate: COMPANY_A_ORIGINAL_RATE })
      .eq("id", COMPANY_A);
  }
  await dropFixture();
});

type Env = Envelope<Record<string, unknown>>;
const call = async (c: SupabaseClient, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await c.rpc(fn, args);
  expect(error, `${fn} raised (expected an envelope): ${error?.message}`).toBeNull();
  return data as Env;
};
const errorOf = (env: Env) => {
  if (env.ok) throw new Error(`expected an error envelope, got ok: ${JSON.stringify(env)}`);
  return env.error;
};

type CompanyRow = {
  companyId: string;
  companyName: string;
  status: string;
  bookings: number;
  revenue: number;
  commission: number;
  net: number;
};
type Commissions = {
  month: string;
  companies: CompanyRow[];
  totals: { bookings: number; revenue: number; commission: number; net: number };
};

const commissionsFor = async (month: string) =>
  okData((await call(admin, "commissions_by_month", { p_month: month })) as Envelope<Commissions>);

const summaryFor = async (date: string) =>
  okData(
    (await call(operator, "operator_summary", {
      p_from_date: date,
      p_to_date: date,
    })) as Envelope<Record<string, number | null>>,
  );

// ===========================================================================
describe("T-ADM-SEC — admin role guard (P0)", () => {
  // Every admin RPC, with arguments that would SUCCEED for a real admin. A
  // guard that only holds for malformed input is not a guard.
  const CALLS = (): [string, Record<string, unknown>][] => [
    ["set_company_status", { p_company_id: COMPANY_S, p_status: "suspended" }],
    ["set_commission_rate", { p_company_id: COMPANY_S, p_rate: 0.33 }],
    ["commissions_by_month", { p_month: tripAMonth }],
    ["delete_city", { p_city_id: CITY_LONE }],
    ["delete_route", { p_route_id: ROUTE_YX }],
  ];

  it("with NO session every one is refused at the GRANT (42501) — the body never runs", async () => {
    // Same posture as the operator RPCs after B7: granted to `authenticated`
    // only, so Postgres refuses before the function executes and PostgREST
    // surfaces 42501 as a transport error rather than a §0 envelope. The
    // `auth.uid() is null → UNAUTHORIZED` branch inside each function is
    // therefore unreachable for anon, and that is the stronger guarantee.
    for (const [fn, args] of CALLS()) {
      const { data, error } = await publicClient().rpc(fn, args);
      expect(error, `${fn} with no session should have been refused`).not.toBeNull();
      expect(error!.code, `${fn} with no session: ${error!.message}`).toBe("42501");
      expect(data, `${fn} returned a body to an ungranted caller`).toBeNull();
    }
  });

  it("as an anonymous PASSENGER every one returns FORBIDDEN", async () => {
    for (const [fn, args] of CALLS()) {
      const env = await call(passenger, fn, args);
      // A session exists (so not UNAUTHORIZED) but user_role is 'passenger'.
      expect(errorOf(env).code, `${fn} as passenger`).toBe("FORBIDDEN");
    }
  });

  it("as an OPERATOR every one returns FORBIDDEN — a company admin is not a platform admin", async () => {
    for (const [fn, args] of CALLS()) {
      const env = await call(operator, fn, args);
      expect(errorOf(env).code, `${fn} as operator`).toBe("FORBIDDEN");
    }
  });

  it("and none of those refused calls changed anything", async () => {
    // The list above contains a suspend, a rate change and two deletes. If any
    // guard let the body run, this is where it shows.
    const { data: company } = await svc
      .from("companies").select("status,commission_rate").eq("id", COMPANY_S).single();
    expect(company).toMatchObject({ status: "approved" });
    expect(Number(company!.commission_rate)).toBe(0.25);

    const { data: city } = await svc.from("cities").select("id").eq("id", CITY_LONE);
    expect(city ?? [], "CITY_LONE must still exist").toHaveLength(1);
    const { data: route } = await svc.from("routes").select("id").eq("id", ROUTE_YX);
    expect(route ?? [], "ROUTE_YX must still exist").toHaveLength(1);
  });
});

// ===========================================================================
describe("T-ADM1-2 — set_commission_rate bounds", () => {
  it("0.19 and 0.36 come back as VALIDATION_ERROR, never a raw 23514", async () => {
    for (const rate of [0.19, 0.36, 0, 1, -0.25]) {
      // call() already asserts the transport error is null — i.e. the CHECK
      // constraint did not escape as an exception, which is the actual
      // requirement. The code assertion is the second half of it.
      const env = await call(admin, "set_commission_rate", {
        p_company_id: COMPANY_S,
        p_rate: rate,
      });
      expect(errorOf(env), `rate ${rate}`).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { field: "commissionRate" },
      });
    }

    const { data } = await svc
      .from("companies").select("commission_rate").eq("id", COMPANY_S).single();
    expect(Number(data!.commission_rate), "no rejected rate may have landed").toBe(0.25);
  });

  it("a rate that only rounds out of range is rejected, not stored", async () => {
    // numeric(4,3) would round 0.3551 to 0.355 and trip the CHECK. The function
    // rounds first and validates the ROUNDED value, so this is a clean envelope.
    const env = await call(admin, "set_commission_rate", {
      p_company_id: COMPANY_S,
      p_rate: 0.3551,
    });
    expect(errorOf(env).code).toBe("VALIDATION_ERROR");

    const { data } = await svc
      .from("companies").select("commission_rate").eq("id", COMPANY_S).single();
    expect(Number(data!.commission_rate)).toBe(0.25);
  });

  it("0.30 is accepted and stored", async () => {
    const company = okData(
      (await call(admin, "set_commission_rate", {
        p_company_id: COMPANY_S,
        p_rate: 0.3,
      })) as Envelope<{ id: string; commissionRate: number; status: string }>,
    );
    expect(Number(company.commissionRate)).toBe(0.3);

    const { data } = await svc
      .from("companies").select("commission_rate").eq("id", COMPANY_S).single();
    expect(Number(data!.commission_rate)).toBe(0.3);

    await call(admin, "set_commission_rate", { p_company_id: COMPANY_S, p_rate: 0.25 }); // restore
  });

  it("an unknown company is NOT_FOUND", async () => {
    const env = await call(admin, "set_commission_rate", {
      p_company_id: "00000000-0000-4000-8000-000000000000",
      p_rate: 0.25,
    });
    expect(errorOf(env).code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
describe("T-ADM1-2 — commission SNAPSHOT regression (ADM-1 AC-2)", () => {
  it("changing a company's rate moves neither operator_summary nor commissions_by_month", async () => {
    // The month holds exactly one booking: 100000 at a snapshotted 0.10.
    const expectedRow = {
      companyId: COMPANY_A,
      bookings: 1,
      revenue: 100000,
      commission: 10000,
      net: 90000,
    };

    const before = await commissionsFor(tripAMonth);
    expect(before.month).toBe(tripAMonth);
    expect(before.companies).toHaveLength(1);
    expect(before.companies[0]).toMatchObject(expectedRow);
    expect(before.totals).toMatchObject({
      bookings: 1, revenue: 100000, commission: 10000, net: 90000,
    });

    const summaryBefore = await summaryFor(tripADate);
    expect(summaryBefore).toMatchObject({ bookings: 1, revenue: 100000, commission: 10000 });

    // Move the rate as far as the contract allows from wherever it is now, so
    // "reads the company" could not accidentally produce the same number.
    const newRate = COMPANY_A_ORIGINAL_RATE >= 0.275 ? 0.2 : 0.35;
    const updated = okData(
      (await call(admin, "set_commission_rate", {
        p_company_id: COMPANY_A,
        p_rate: newRate,
      })) as Envelope<{ commissionRate: number }>,
    );
    expect(Number(updated.commissionRate)).toBe(newRate);

    // THE ASSERTION. Both reports read bookings.commission_rate (0.10), so both
    // are byte-identical to before. 100000 × newRate would be 20000 or 35000.
    const after = await commissionsFor(tripAMonth);
    expect(after).toEqual(before);
    expect(after.companies[0].commission).not.toBe(Math.round(100000 * newRate));

    const summaryAfter = await summaryFor(tripADate);
    expect(summaryAfter).toEqual(summaryBefore);
    expect(summaryAfter.commission).not.toBe(Math.round(100000 * newRate));

    // …and the new rate really did land — otherwise this test would pass on a
    // set_commission_rate that silently does nothing at all.
    const { data } = await svc
      .from("companies").select("commission_rate").eq("id", COMPANY_A).single();
    expect(Number(data!.commission_rate)).toBe(newRate);

    await call(admin, "set_commission_rate", {
      p_company_id: COMPANY_A,
      p_rate: COMPANY_A_ORIGINAL_RATE,
    });
  });

  it("a month with no confirmed bookings is empty, not an error", async () => {
    const data = await commissionsFor("2019-01");
    expect(data.companies).toEqual([]);
    expect(data.totals).toMatchObject({ bookings: 0, revenue: 0, commission: 0, net: 0 });
  });

  it("a malformed month is VALIDATION_ERROR, not SQLSTATE 22007", async () => {
    for (const month of ["2026-13", "2026-00", "nope", "2026-1", "2026-01-01"]) {
      const env = await call(admin, "commissions_by_month", { p_month: month });
      expect(errorOf(env), `month ${JSON.stringify(month)}`).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { field: "month" },
      });
    }
  });
});

// ===========================================================================
describe("ADM-1 — set_company_status", () => {
  it("suspending a company removes its trips from the NEXT search_trips call", async () => {
    const search = async () => {
      const { data, error } = await publicClient().rpc("search_trips", {
        p_from_slug: SCRATCH_CITY_SLUGS.x,
        p_to_slug: SCRATCH_CITY_SLUGS.y,
        p_travel_date: tripSDate,
        p_passengers: 1,
      });
      expect(error, `search_trips raised: ${error?.message}`).toBeNull();
      return (data as { id: string }[]).map((t) => t.id);
    };

    expect(await search(), "the approved company's trip must be searchable").toContain(TRIP_S);

    const suspended = okData(
      (await call(admin, "set_company_status", {
        p_company_id: COMPANY_S,
        p_status: "suspended",
      })) as Envelope<{ status: string }>,
    );
    expect(suspended.status).toBe("suspended");

    // No cache step: search_trips filters c.status = 'approved' at query time.
    expect(await search(), "a suspended company's trips must vanish").not.toContain(TRIP_S);

    // Suspension is not cancellation — the trip is untouched and comes back.
    const { data: trip } = await svc
      .from("trips").select("status,price").eq("id", TRIP_S).single();
    expect(trip).toMatchObject({ status: "published", price: 50000 });

    await call(admin, "set_company_status", {
      p_company_id: COMPANY_S,
      p_status: "approved",
    });
    expect(await search(), "re-approving restores visibility").toContain(TRIP_S);
  });

  it("rejects an unknown status and an unknown company", async () => {
    expect(
      errorOf(
        await call(admin, "set_company_status", {
          p_company_id: COMPANY_S,
          p_status: "archived",
        }),
      ),
    ).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "status" } });

    expect(
      errorOf(
        await call(admin, "set_company_status", {
          p_company_id: "00000000-0000-4000-8000-000000000000",
          p_status: "approved",
        }),
      ).code,
    ).toBe("NOT_FOUND");
  });
});

// ===========================================================================
describe("T-ADM2-1 — guarded city / route deletes", () => {
  it("a route with future published trips is blocked WITH the count", async () => {
    const err = errorOf(await call(admin, "delete_route", { p_route_id: ROUTE_XY }));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toMatchObject({ field: "routeId", reason: "future_trips" });
    expect(Number(err.details!.trips)).toBeGreaterThan(0);

    const { data } = await svc.from("routes").select("id").eq("id", ROUTE_XY);
    expect(data ?? [], "the blocked route must survive").toHaveLength(1);
  });

  it("a city at either end of such a route is blocked the same way", async () => {
    for (const city of [CITY_X, CITY_Y]) {
      const err = errorOf(await call(admin, "delete_city", { p_city_id: city }));
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.details, `city ${city}`).toMatchObject({
        field: "cityId",
        reason: "future_trips",
      });
    }

    const { data } = await svc.from("cities").select("id").in("id", [CITY_X, CITY_Y]);
    expect(data ?? []).toHaveLength(2);
  });

  it("a city whose routes carry no trips is blocked for a DIFFERENT reason", async () => {
    // Nothing future is at stake, but the route rows still reference it. The UI
    // needs to tell these apart — one is "wait until the trips are done", the
    // other is "delete the route first".
    const err = errorOf(await call(admin, "delete_city", { p_city_id: CITY_M }));
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toMatchObject({ field: "cityId", reason: "referenced_by_routes" });
    expect(Number(err.details!.routes)).toBe(1);
  });

  it("a route with no trips deletes, and so does a city with no routes", async () => {
    const route = okData(
      (await call(admin, "delete_route", { p_route_id: ROUTE_YX })) as Envelope<{
        id: string;
        deleted: boolean;
      }>,
    );
    expect(route).toMatchObject({ id: ROUTE_YX, deleted: true });
    const { data: routes } = await svc.from("routes").select("id").eq("id", ROUTE_YX);
    expect(routes ?? []).toHaveLength(0);

    const city = okData(
      (await call(admin, "delete_city", { p_city_id: CITY_LONE })) as Envelope<{
        id: string;
        deleted: boolean;
      }>,
    );
    expect(city).toMatchObject({ id: CITY_LONE, deleted: true });
    const { data: cities } = await svc.from("cities").select("id").eq("id", CITY_LONE);
    expect(cities ?? []).toHaveLength(0);
  });

  it("an unknown id is NOT_FOUND on both", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(errorOf(await call(admin, "delete_city", { p_city_id: missing })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await call(admin, "delete_route", { p_route_id: missing })).code).toBe(
      "NOT_FOUND",
    );
  });
});
