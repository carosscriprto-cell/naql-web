import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  publicClient,
  serviceClient,
  okData,
  type Envelope,
  type SupabaseClient,
} from "./helpers";

// B5 / M5 — operator RPCs (BACKEND_V1 §5).
//
// The centrepiece is the TENANT ISOLATION GATE (OPR-1 AC-3, a launch blocker):
// operator A must not be able to read or move operator B's data through ANY
// path. These functions are SECURITY DEFINER, so RLS is not the boundary — the
// company checks inside each function are, and this file is what proves they
// are all still there.
//
// Fixture: a private block under a reserved uuid prefix, torn down in afterAll.
// No seeded row is inserted, updated or deleted. The scratch trips reference
// the two seeded companies by FK because an operator SESSION can only be had
// for a seeded operator account (the access-token hook reads profiles, and a
// password cannot be minted through PostgREST).
//
// A crashed run leaves a greppable orphan, hand-cleanable with:
//   delete from bookings where id::text like '000000ee-0000-4000-8000-0000d00c%';
//   delete from trips    where id::text like '000000ee-0000-4000-8000-0000d00c%';
//   delete from buses    where id::text like '000000ee-0000-4000-8000-0000d00c%';
//   delete from routes   where id::text like '000000ee-0000-4000-8000-0000d00c%';

const D = "000000ee-0000-4000-8000-0000d00c";
const ROUTE = `${D}0001`; // حمص→طرطوس — not a seeded pair
const BUS_A = `${D}0002`;
const BUS_B = `${D}0003`;
const TRIP_A1 = `${D}0010`; // company A, published, +8d — manifest / check-in / summary
const TRIP_A2 = `${D}0011`; // company A, published, +9d — cancel_trip target
const TRIP_B1 = `${D}0012`; // company B, published, +8d — cross-tenant target
const TRIP_B2 = `${D}0013`; // company B, DRAFT — PostgREST select isolation
const BOOKING_A1 = `${D}0020`; // 2 seats, snapshot rate 0.10
const BOOKING_A1B = `${D}0021`; // 1 seat,  snapshot rate 0.30
const BOOKING_A2 = `${D}0022`; // on TRIP_A2, for cancel_trip
const BOOKING_B1 = `${D}0023`; // on TRIP_B1, cross-tenant target

// Operator A's company is NOT hardcoded: it is whatever company the account in
// TEST_OPERATOR_EMAIL belongs to, read from that session's `company_id` claim —
// the same value the RPCs themselves guard on (auth.jwt()->>'company_id',
// BACKEND_V1 §5). Pinning it to a uuid meant the fixture only worked when
// TEST_OPERATOR_EMAIL happened to be الأمانة: any other seeded operator signed
// in as itself, then failed every case that reads A's data, because the trips
// belonged to a company its session had no claim to. Resolved in beforeAll.
let COMPANY_A: string;
let COMPANY_B: string;
/** COMPANY_A's CURRENT commission rate — the WRONG answer for a snapshot. */
let COMPANY_A_RATE: number;

/**
 * The three operator accounts in supabase/seed.sql. Operator B is picked from
 * this list as the first one whose company differs from A's, so the pair is
 * always cross-tenant no matter which of them TEST_OPERATOR_EMAIL names.
 */
const SEEDED_OPERATORS = [
  "operator.amana@naql.dev",
  "operator.kadmous@naql.dev",
  "operator.ahlia@naql.dev",
];

const HOMS = "000000c1-0000-4000-8000-000000000003";
const TARTUS = "000000c1-0000-4000-8000-000000000006";
const DEMO_PASSENGER = "000000db-0000-4000-8000-000000000001";

const PHONE_A1 = "+963900000001";
const PHONE_A1B = "+963900000002";

// PNRs are randomised PER RUN. lookup_booking (the only way to obtain a real
// qrPayload without the Vault secret) is rate-limited to lookup_rate_limit_max
// attempts per PNR per hour, and that ledger counts hits as well as misses. A
// fixed PNR would therefore exhaust its budget after a few suite runs and fail
// the check-in cases for a reason that has nothing to do with check_in — which
// is precisely what "green 3 consecutive runs" would trip over. A fresh PNR
// each run also sidesteps the UNIQUE(pnr) constraint if a crashed run ever
// leaves a booking behind.
const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0 O 1 I (§4)
const RUN = Array.from(
  { length: 4 },
  () => PNR_ALPHABET[Math.floor(Math.random() * PNR_ALPHABET.length)],
).join("");
const PNR_A1 = `A1${RUN}`;
const PNR_A1B = `A2${RUN}`;
const PNR_A2 = `A3${RUN}`;
const PNR_B1 = `B1${RUN}`;

const svc = serviceClient();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Set it in .env.test.`);
  return value;
}

/**
 * Every seeded operator account shares one password (supabase/seed.sql
 * documents `Password123!` for all of them, and ci.yml passes it as
 * TEST_OPERATOR_PASSWORD), so an email is enough to open any of their sessions.
 *
 * Returns the client AND the company its JWT claims, because that claim — not a
 * uuid written into this file — is what every operator RPC authorises against.
 */
async function operatorClient(
  email: string,
): Promise<{ client: SupabaseClient; companyId: string }> {
  const client = publicClient();
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: required("TEST_OPERATOR_PASSWORD"),
  });
  if (error) throw new Error(`operator sign-in failed for ${email}: ${error.message}`);

  // Read company_id straight out of the access token: the custom access token
  // hook puts it there (20260725202100_schema_rls_hook.sql) and the RPCs read
  // it back with auth.jwt()->>'company_id'. Anything else would be testing a
  // different value than the one under test.
  const token = data.session?.access_token;
  if (!token) throw new Error(`no session for ${email}`);
  const claims = JSON.parse(
    Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
  ) as { company_id?: string; user_role?: string };

  if (claims.user_role !== "operator" || !claims.company_id) {
    throw new Error(
      `${email} is not a seeded OPERATOR account (user_role=${claims.user_role ?? "?"}, ` +
        `company_id=${claims.company_id ?? "none"}). TEST_OPERATOR_EMAIL must name one of: ` +
        SEEDED_OPERATORS.join(", "),
    );
  }
  return { client, companyId: claims.company_id };
}

let opA: SupabaseClient; // TEST_OPERATOR_EMAIL's company
let opB: SupabaseClient; // any other seeded operator's company
let summaryDate: string; // Damascus-local date of TRIP_A1

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

// Buses and trips created THROUGH the RPCs get generated ids; collect them for teardown.
const createdBusIds: string[] = [];
const createdTripIds: string[] = [];

async function dropFixture() {
  const bookings = [BOOKING_A1, BOOKING_A1B, BOOKING_A2, BOOKING_B1];
  const trips = [TRIP_A1, TRIP_A2, TRIP_B1, TRIP_B2, ...createdTripIds];
  await svc.from("booking_passengers").delete().in("booking_id", bookings);
  await svc.from("bookings").delete().in("id", bookings);
  await svc.from("seat_locks").delete().in("trip_id", trips);
  await svc.from("trips").delete().in("id", trips);
  // Any trip left on the scratch route by a create_trip case whose id we missed.
  await svc.from("trips").delete().eq("route_id", ROUTE);
  await svc.from("buses").delete().in("id", [BUS_A, BUS_B, ...createdBusIds]);
  // Anything create_bus made with a scratch plate.
  await svc.from("buses").delete().like("plate_number", "OPRSCRATCH%");
  await svc.from("routes").delete().eq("id", ROUTE);
}

beforeAll(async () => {
  await dropFixture(); // a previous crashed run may have left the block behind

  const a = await operatorClient(required("TEST_OPERATOR_EMAIL"));
  opA = a.client;
  COMPANY_A = a.companyId;

  // Operator B = the first seeded operator that is NOT in A's company. Chosen
  // by claim, not by address, so this stays cross-tenant whichever account
  // TEST_OPERATOR_EMAIL names — including when it names this list's first entry.
  let b: { client: SupabaseClient; companyId: string } | undefined;
  for (const email of SEEDED_OPERATORS) {
    const candidate = await operatorClient(email);
    if (candidate.companyId !== COMPANY_A) {
      b = candidate;
      break;
    }
  }
  if (!b) {
    throw new Error(
      "no seeded operator outside TEST_OPERATOR_EMAIL's company — the tenant-isolation gate " +
        "(OPR-1 AC-3) cannot be proven with one company. Check supabase/seed.sql.",
    );
  }
  opB = b.client;
  COMPANY_B = b.companyId;

  // A's CURRENT rate, read live rather than hardcoded: the summary assertion
  // needs a value it can prove the RPC did NOT use.
  const { data: companyA, error: rateErr } = await svc
    .from("companies")
    .select("commission_rate")
    .eq("id", COMPANY_A)
    .single();
  if (rateErr) throw new Error(`reading COMPANY_A rate: ${rateErr.message}`);
  COMPANY_A_RATE = Number(companyA.commission_rate);

  const depA1 = departureUtc(8);
  const depA2 = departureUtc(9);
  summaryDate = damascusDate(depA1);
  const plus3h = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString();

  await arrange(
    "route",
    svc.from("routes").insert({
      id: ROUTE,
      from_city_id: HOMS,
      to_city_id: TARTUS,
      default_duration_min: 180,
    }),
  );

  await arrange(
    "buses",
    svc.from("buses").insert([
      {
        id: BUS_A,
        company_id: COMPANY_A,
        plate_number: "OPRSCRATCH-A",
        bus_type: "VIP",
        layout: { rows: 12, cols: 4, aisleAfterCol: 2 },
      },
      {
        id: BUS_B,
        company_id: COMPANY_B,
        plate_number: "OPRSCRATCH-B",
        bus_type: "عادي",
        layout: { rows: 12, cols: 4, aisleAfterCol: 2 },
      },
    ]),
  );

  await arrange(
    "trips",
    svc.from("trips").insert([
      {
        id: TRIP_A1, company_id: COMPANY_A, route_id: ROUTE, bus_id: BUS_A,
        departure_at: depA1.toISOString(), arrival_at: plus3h(depA1),
        price: 50000, status: "published",
      },
      {
        id: TRIP_A2, company_id: COMPANY_A, route_id: ROUTE, bus_id: BUS_A,
        departure_at: depA2.toISOString(), arrival_at: plus3h(depA2),
        price: 50000, status: "published",
      },
      {
        id: TRIP_B1, company_id: COMPANY_B, route_id: ROUTE, bus_id: BUS_B,
        departure_at: depA1.toISOString(), arrival_at: plus3h(depA1),
        price: 50000, status: "published",
      },
      {
        id: TRIP_B2, company_id: COMPANY_B, route_id: ROUTE, bus_id: BUS_B,
        departure_at: depA2.toISOString(), arrival_at: plus3h(depA2),
        price: 50000, status: "draft",
      },
    ]),
  );

  // Two bookings on TRIP_A1 with DELIBERATELY DIFFERENT snapshotted rates,
  // neither equal to company A's current rate. That is what makes the
  // operator_summary assertion able to tell "reads the snapshot" apart from
  // "reads the company" without mutating a single seeded row.
  await arrange(
    "bookings",
    svc.from("bookings").insert([
      {
        id: BOOKING_A1, trip_id: TRIP_A1, user_id: DEMO_PASSENGER, pnr: PNR_A1,
        status: "confirmed", payment_method: "cash", total_price: 100000,
        commission_rate: 0.1, idempotency_key: `${D}0030`,
      },
      {
        id: BOOKING_A1B, trip_id: TRIP_A1, user_id: DEMO_PASSENGER, pnr: PNR_A1B,
        status: "confirmed", payment_method: "cash", total_price: 100000,
        commission_rate: 0.3, idempotency_key: `${D}0031`,
      },
      {
        id: BOOKING_A2, trip_id: TRIP_A2, user_id: DEMO_PASSENGER, pnr: PNR_A2,
        status: "confirmed", payment_method: "cash", total_price: 50000,
        commission_rate: 0.25, idempotency_key: `${D}0032`,
      },
      {
        id: BOOKING_B1, trip_id: TRIP_B1, user_id: DEMO_PASSENGER, pnr: PNR_B1,
        status: "confirmed", payment_method: "cash", total_price: 50000,
        commission_rate: 0.25, idempotency_key: `${D}0033`,
      },
    ]),
  );

  await arrange(
    "passengers",
    svc.from("booking_passengers").insert([
      { booking_id: BOOKING_A1, trip_id: TRIP_A1, seat_number: "1", full_name: "سمير حسن", phone: PHONE_A1, gender: "male", active: true },
      { booking_id: BOOKING_A1, trip_id: TRIP_A1, seat_number: "2", full_name: "ليلى مراد", phone: PHONE_A1, gender: "female", active: true },
      { booking_id: BOOKING_A1B, trip_id: TRIP_A1, seat_number: "3", full_name: "عمر خالد", phone: PHONE_A1B, gender: "male", active: true },
      { booking_id: BOOKING_A2, trip_id: TRIP_A2, seat_number: "1", full_name: "نور علي", phone: "+963900000003", gender: "female", active: true },
      { booking_id: BOOKING_B1, trip_id: TRIP_B1, seat_number: "1", full_name: "رامي سعيد", phone: "+963900000004", gender: "male", active: true },
    ]),
  );
});

afterAll(dropFixture);

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

// ===========================================================================
describe("operator RPCs — role guard", () => {
  // Every operator RPC, with arguments that would succeed for a real operator.
  const CALLS: [string, Record<string, unknown>][] = [
    ["create_trip", { p_route_id: ROUTE, p_bus_id: BUS_A, p_departure_at: new Date(Date.now() + 864e5).toISOString(), p_arrival_at: new Date(Date.now() + 9e7).toISOString(), p_price: 1000 }],
    ["update_trip", { p_trip_id: TRIP_A1, p_price: 1000 }],
    ["cancel_trip", { p_trip_id: TRIP_A1 }],
    ["get_manifest", { p_trip_id: TRIP_A1 }],
    ["check_in", { p_qr_payload: "x.y" }],
    ["check_in_by_pnr", { p_pnr: PNR_A1 }],
    ["operator_cancel_booking", { p_booking_id: BOOKING_A1 }],
    ["set_booking_payment_status", { p_booking_id: BOOKING_A1, p_payment_status: "paid" }],
    ["create_bus", { p_plate_number: "OPRSCRATCH-Z", p_bus_type: "VIP", p_layout: { rows: 1, cols: 1, aisleAfterCol: 1 } }],
    ["update_bus", { p_bus_id: BUS_A, p_bus_type: "VIP" }],
    ["operator_summary", { p_from_date: "2026-01-01", p_to_date: "2026-12-31" }],
  ];

  // A RAW ANON KEY IS REJECTED AT THE GRANT, NOT BY THE FUNCTION BODY.
  //
  // This case used to expect the UNAUTHORIZED envelope. That expectation
  // predates B7 (20260727170000_b7_grants_hardening.sql), which grants every
  // operator RPC to `authenticated` ONLY and revokes anon. Postgres now refuses
  // the call before the function runs, so PostgREST surfaces 42501
  // (insufficient_privilege) as a transport error and there is no envelope at
  // all — the `auth.uid() is null → UNAUTHORIZED` branch inside each function is
  // simply unreachable for anon.
  //
  // This is the STRONGER guarantee, not a regression: an envelope means the body
  // executed and chose to say no, while 42501 means the body never ran. Nothing
  // inside the function — not a typo'd role check, not a future edit that
  // reorders the guards — can leak anything, because control never reaches it.
  // security.test.ts asserts the same surface from the grant side; this asserts
  // that a client actually hits it.
  it("with NO session every one is refused at the GRANT (42501) — the body never runs", async () => {
    for (const [fn, args] of CALLS) {
      const { data, error } = await publicClient().rpc(fn, args);

      expect(error, `${fn} with no session should have been refused`).not.toBeNull();
      expect(error!.code, `${fn} with no session: ${error!.message}`).toBe("42501");
      // No envelope came back — that is the point of failing at the grant.
      expect(data, `${fn} returned a body to an ungranted caller`).toBeNull();
    }
    // The destructive ones in that list must not have fired.
    const { data: trip } = await svc.from("trips").select("status,price").eq("id", TRIP_A1).single();
    expect(trip).toMatchObject({ status: "published", price: 50000 });

    const { data: booking } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_A1).single();
    expect(booking!.payment_status, "an ungranted caller moved the till").toBe("unpaid");
  });

  it("as an anonymous PASSENGER every one returns FORBIDDEN", async () => {
    const passenger = publicClient();
    const { error } = await passenger.auth.signInAnonymously();
    expect(error, `anonymous sign-in failed: ${error?.message}`).toBeNull();

    for (const [fn, args] of CALLS) {
      const env = await call(passenger, fn, args);
      // A session exists (so not UNAUTHORIZED) but carries user_role=passenger.
      expect(errorOf(env).code, `${fn} as passenger`).toBe("FORBIDDEN");
    }
  });
});

// ===========================================================================
describe("TENANT ISOLATION GATE (OPR-1 AC-3 — launch blocker)", () => {
  it("operator A cannot read or move operator B's trip through ANY rpc", async () => {
    // NOT_FOUND, never FORBIDDEN: FORBIDDEN would confirm the row exists.
    for (const [fn, args] of [
      ["update_trip", { p_trip_id: TRIP_B1, p_price: 999000 }],
      ["cancel_trip", { p_trip_id: TRIP_B1 }],
      ["get_manifest", { p_trip_id: TRIP_B1 }],
    ] as [string, Record<string, unknown>][]) {
      const env = await call(opA, fn, args);
      expect(errorOf(env).code, `${fn} on B's trip`).toBe("NOT_FOUND");
    }

    // …and B's trip is genuinely untouched.
    const { data: trip } = await svc
      .from("trips").select("price,status").eq("id", TRIP_B1).single();
    expect(trip).toMatchObject({ price: 50000, status: "published" });
  });

  it("operator A cannot cancel operator B's booking", async () => {
    const env = await call(opA, "operator_cancel_booking", { p_booking_id: BOOKING_B1 });
    expect(errorOf(env).code).toBe("NOT_FOUND");

    const { data: booking } = await svc
      .from("bookings").select("status").eq("id", BOOKING_B1).single();
    expect(booking!.status).toBe("confirmed");
  });

  it("operator A cannot edit operator B's bus", async () => {
    const env = await call(opA, "update_bus", { p_bus_id: BUS_B, p_bus_type: "VIP" });
    expect(errorOf(env).code).toBe("NOT_FOUND");

    const { data: bus } = await svc.from("buses").select("bus_type").eq("id", BUS_B).single();
    expect(bus!.bus_type).toBe("عادي");
  });

  it("operator A cannot create a trip on operator B's bus", async () => {
    const dep = departureUtc(11);
    const env = await call(opA, "create_trip", {
      p_route_id: ROUTE,
      p_bus_id: BUS_B,
      p_departure_at: dep.toISOString(),
      p_arrival_at: new Date(dep.getTime() + 3 * 3_600_000).toISOString(),
      p_price: 50000,
    });
    expect(errorOf(env).code).toBe("NOT_FOUND");
  });

  it("a PostgREST trips select gives operator A zero rows of B's DRAFT trip", async () => {
    // Published future trips are public catalog data and visible to everyone by
    // design (§2). A DRAFT trip is the operator-scoped case, so it is the one
    // that proves trips_operator_read is company-scoped.
    const { data: aSees } = await opA.from("trips").select("id").eq("id", TRIP_B2);
    expect(aSees ?? []).toHaveLength(0);

    const { data: bSees } = await opB.from("trips").select("id").eq("id", TRIP_B2);
    expect(bSees ?? [], "operator B must see its own draft").toHaveLength(1);
  });
});

// ===========================================================================
describe("trips", () => {
  it("create_trip makes a DRAFT — never searchable on creation", async () => {
    const dep = departureUtc(12);
    const env = await call(opA, "create_trip", {
      p_route_id: ROUTE,
      p_bus_id: BUS_A,
      p_departure_at: dep.toISOString(),
      p_arrival_at: new Date(dep.getTime() + 3 * 3_600_000).toISOString(),
      p_price: 77000,
    });
    const trip = okData(env as Envelope<{ id: string; status: string; price: number }>);
    createdTripIds.push(trip.id);

    expect(trip.status).toBe("draft");
    expect(trip.price).toBe(77000);

    const { data: rows } = await publicClient().rpc("search_trips", {
      p_from_slug: "homs", p_to_slug: "tartus",
      p_travel_date: damascusDate(dep), p_passengers: 1,
    });
    expect((rows as { id: string }[]).map((t) => t.id)).not.toContain(trip.id);
  });

  it("publishing via update_trip makes it searchable on the NEXT call", async () => {
    const dep = departureUtc(13);
    const created = okData(
      (await call(opA, "create_trip", {
        p_route_id: ROUTE, p_bus_id: BUS_A,
        p_departure_at: dep.toISOString(),
        p_arrival_at: new Date(dep.getTime() + 3 * 3_600_000).toISOString(),
        p_price: 81000,
      })) as Envelope<{ id: string }>,
    );
    createdTripIds.push(created.id);

    const search = async () => {
      const { data } = await publicClient().rpc("search_trips", {
        p_from_slug: "homs", p_to_slug: "tartus",
        p_travel_date: damascusDate(dep), p_passengers: 1,
      });
      return (data as { id: string }[]).map((t) => t.id);
    };

    expect(await search()).not.toContain(created.id);
    await call(opA, "update_trip", { p_trip_id: created.id, p_status: "published" });
    expect(await search(), "no cache step — status is filtered at query time").toContain(created.id);
  });

  it("rejects an illegal status and a negative price", async () => {
    expect(errorOf(await call(opA, "update_trip", { p_trip_id: TRIP_A1, p_status: "archived" })))
      .toMatchObject({ code: "VALIDATION_ERROR", details: { field: "status" } });
    expect(errorOf(await call(opA, "update_trip", { p_trip_id: TRIP_A1, p_price: -1 })))
      .toMatchObject({ code: "VALIDATION_ERROR", details: { field: "price" } });
  });

  it("a price change NEVER touches existing bookings' total_price", async () => {
    const before = await svc
      .from("bookings").select("total_price,commission_rate").eq("id", BOOKING_A1).single();
    expect(before.data!.total_price).toBe(100000);

    okData(await call(opA, "update_trip", { p_trip_id: TRIP_A1, p_price: 999000 }) as Envelope<unknown>);

    const after = await svc
      .from("bookings").select("total_price,commission_rate").eq("id", BOOKING_A1).single();
    // The ticket is a contract at the price that was paid — repricing the trip
    // must not reprice it, and must not move the snapshotted commission either.
    expect(after.data!.total_price).toBe(100000);
    expect(Number(after.data!.commission_rate)).toBe(0.1);

    await call(opA, "update_trip", { p_trip_id: TRIP_A1, p_price: 50000 }); // restore
  });

  it("cancel_trip cancels every booking, frees the seats, and returns the count", async () => {
    const env = await call(opA, "cancel_trip", { p_trip_id: TRIP_A2 });
    const data = okData(env as Envelope<{ cancelledBookings: number }>);
    expect(data.cancelledBookings).toBe(1);

    const { data: booking } = await svc
      .from("bookings").select("status").eq("id", BOOKING_A2).single();
    expect(booking!.status).toBe("cancelled");

    const { data: pax } = await svc
      .from("booking_passengers").select("active").eq("booking_id", BOOKING_A2);
    expect((pax ?? []).every((p) => p.active === false)).toBe(true);

    const { data: trip } = await svc.from("trips").select("status").eq("id", TRIP_A2).single();
    expect(trip!.status).toBe("cancelled");
  });
});

// ===========================================================================
describe("get_manifest", () => {
  it("lists active passengers with gender, phone and checkedInAt", async () => {
    const env = await call(opA, "get_manifest", { p_trip_id: TRIP_A1 });
    const data = okData(
      env as Envelope<{ passengers: Record<string, unknown>[] }>,
    );

    expect(data.passengers).toHaveLength(3);
    expect(data.passengers.map((p) => p.seatNumber)).toEqual(["1", "2", "3"]);
    expect(data.passengers[0]).toMatchObject({
      seatNumber: "1",
      fullName: "سمير حسن",
      gender: "male",
      phone: PHONE_A1,
      checkedInAt: null,
      // B10: READ from bookings.payment_status, no longer derived from
      // checked_in_at. The fixture never sets it, so this is the column default.
      paymentStatus: "unpaid",
    });
    expect(data.passengers[1]).toMatchObject({ gender: "female" });
  });

  it("every passenger is unpaid by default — the column default, not an inference", async () => {
    const data = okData(
      (await call(opA, "get_manifest", { p_trip_id: TRIP_A1 })) as Envelope<{
        passengers: Record<string, unknown>[];
      }>,
    );
    expect(data.passengers.map((p) => p.paymentStatus)).toEqual([
      "unpaid",
      "unpaid",
      "unpaid",
    ]);

    // And it really is the column that is being read, not a constant: the two
    // seats of BOOKING_A1 share one booking row, so the manifest value must
    // track that row rather than each passenger.
    const { data: bookings } = await svc
      .from("bookings")
      .select("id,payment_status")
      .in("id", [BOOKING_A1, BOOKING_A1B]);
    expect((bookings ?? []).every((b) => b.payment_status === "unpaid")).toBe(true);
  });
});

// ===========================================================================
describe("check_in", () => {
  // Memoised: lookup_booking's rate-limit ledger counts every call, hit or
  // miss, so each PNR is looked up exactly ONCE per run no matter how many
  // cases need its QR.
  const qrCache = new Map<string, string>();

  /** A real qrPayload for a scratch booking, via the unauthenticated §4 lookup. */
  async function qrFor(pnr: string, phone: string): Promise<string> {
    const cached = qrCache.get(pnr);
    if (cached) return cached;

    const { data, error } = await publicClient().rpc("lookup_booking", {
      p_pnr: pnr,
      p_phone: phone,
    });
    expect(error, `lookup_booking raised: ${error?.message}`).toBeNull();

    const env = data as Envelope<{ qrPayload: string }>;
    if (!env.ok) {
      throw new Error(
        `lookup_booking could not return a ticket for ${pnr} (${env.error.code}). ` +
          "If the fixture inserted correctly this is the per-PNR hourly rate limit " +
          "(app_config.lookup_rate_limit_max) — PNRs are randomised per run to avoid it, " +
          "so a hit here means the suite ran many times within the window.",
      );
    }

    qrCache.set(pnr, env.data.qrPayload);
    return env.data.qrPayload;
  }

  it("a tampered HMAC is rejected as NOT_FOUND, indistinguishable from a miss", async () => {
    const qr = await qrFor(PNR_A1, PHONE_A1);
    const [id, sig] = qr.split(".");
    // Flip one hex character of the signature.
    const flipped = sig.slice(0, -1) + (sig.at(-1) === "a" ? "b" : "a");

    const env = await call(opA, "check_in", { p_qr_payload: `${id}.${flipped}` });
    expect(errorOf(env)).toMatchObject({
      code: "NOT_FOUND",
      details: { reason: "not_found" },
    });

    // Nothing was checked in on the way to the rejection.
    const { data: pax } = await svc
      .from("booking_passengers").select("checked_in_at").eq("booking_id", BOOKING_A1);
    expect((pax ?? []).every((p) => p.checked_in_at === null)).toBe(true);
  });

  it("a malformed payload is the same NOT_FOUND", async () => {
    for (const payload of ["", "not-a-uuid.deadbeef", `${BOOKING_A1}.`]) {
      const env = await call(opA, "check_in", { p_qr_payload: payload });
      expect(errorOf(env).code, `payload ${JSON.stringify(payload)}`).toBe("NOT_FOUND");
    }
  });

  it("ANOTHER COMPANY's genuine ticket is rejected with the same NOT_FOUND", async () => {
    const qr = await qrFor(PNR_A1, PHONE_A1); // a booking on company A's trip
    const env = await call(opB, "check_in", { p_qr_payload: qr }); // scanned by company B
    expect(errorOf(env)).toMatchObject({
      code: "NOT_FOUND",
      details: { reason: "not_found" },
    });
  });

  it("a valid scan checks in every active passenger on the booking", async () => {
    const qr = await qrFor(PNR_A1, PHONE_A1);
    const env = await call(opA, "check_in", { p_qr_payload: qr });
    const data = okData(
      env as Envelope<{ booking: { pnr: string }; passengers: { seatNumber: string }[] }>,
    );

    expect(data.booking.pnr).toBe(PNR_A1);
    // One QR per BOOKING (§4), and this booking holds two seats.
    expect(data.passengers.map((p) => p.seatNumber)).toEqual(["1", "2"]);

    const { data: pax } = await svc
      .from("booking_passengers").select("checked_in_at").eq("booking_id", BOOKING_A1);
    expect((pax ?? []).every((p) => p.checked_in_at !== null)).toBe(true);
  });

  it("re-scanning reports already-checked-in WITH the timestamp", async () => {
    const qr = await qrFor(PNR_A1, PHONE_A1);
    const env = await call(opA, "check_in", { p_qr_payload: qr });
    const err = errorOf(env);

    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toMatchObject({ reason: "already_checked_in" });
    expect(String(err.details!.checkedInAt)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  });

  // B10 — THE REGRESSION THIS MILESTONE EXISTS FOR.
  //
  // This case used to assert `paymentStatus === "paid"` after a scan, because
  // get_manifest derived payment from checked_in_at. That was the bug in test
  // form: boarding is not payment. Checking in now moves checkedInAt and
  // NOTHING else, and a passenger who has not paid still reads unpaid at the
  // gate — which is the whole point of showing the field to the operator.
  it("checking in timestamps the seats and leaves payment ALONE", async () => {
    const data = okData(
      (await call(opA, "get_manifest", { p_trip_id: TRIP_A1 })) as Envelope<{
        passengers: Record<string, unknown>[];
      }>,
    );
    const seat1 = data.passengers.find((p) => p.seatNumber === "1")!;
    expect(seat1.checkedInAt).not.toBeNull();
    expect(seat1.paymentStatus, "check_in must not collect a fare").toBe("unpaid");

    // Seat 3 is a different booking — untouched by that scan, on both facts.
    const seat3 = data.passengers.find((p) => p.seatNumber === "3")!;
    expect(seat3).toMatchObject({ checkedInAt: null, paymentStatus: "unpaid" });

    // …and the column agrees with the wire.
    const { data: booking } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_A1).single();
    expect(booking!.payment_status).toBe("unpaid");
  });

  it("check_in_by_pnr follows the same company rules", async () => {
    expect(errorOf(await call(opB, "check_in_by_pnr", { p_pnr: PNR_A1B })).code).toBe("NOT_FOUND");
    expect(errorOf(await call(opA, "check_in_by_pnr", { p_pnr: "NOSUCH" })).code).toBe("NOT_FOUND");

    const data = okData(
      (await call(opA, "check_in_by_pnr", { p_pnr: PNR_A1B.toLowerCase() })) as Envelope<{
        passengers: { seatNumber: string }[];
      }>,
    );
    expect(data.passengers.map((p) => p.seatNumber)).toEqual(["3"]);
  });
});

// ===========================================================================
// B10 — set_booking_payment_status. Runs AFTER check_in and BEFORE
// operator_cancel_booking on purpose: it needs BOOKING_A1 and BOOKING_A1B both
// alive (the isolation case), and it needs the check-in above to have already
// happened (so "paid" here cannot be confused with a side effect of boarding).
describe("set_booking_payment_status", () => {
  const paymentBySeat = async (): Promise<Record<string, string>> => {
    const data = okData(
      (await call(opA, "get_manifest", { p_trip_id: TRIP_A1 })) as Envelope<{
        passengers: { seatNumber: string; paymentStatus: string }[];
      }>,
    );
    return Object.fromEntries(
      data.passengers.map((p): [string, string] => [p.seatNumber, p.paymentStatus]),
    );
  };

  it("marking a booking paid moves THAT booking's seats and no others", async () => {
    expect(await paymentBySeat()).toEqual({ "1": "unpaid", "2": "unpaid", "3": "unpaid" });

    const paid = okData(
      (await call(opA, "set_booking_payment_status", {
        p_booking_id: BOOKING_A1,
        p_payment_status: "paid",
      })) as Envelope<{ id: string; pnr: string; paymentStatus: string }>,
    );
    expect(paid).toMatchObject({ id: BOOKING_A1, pnr: PNR_A1, paymentStatus: "paid" });

    // Seats 1 and 2 are the two seats of BOOKING_A1; seat 3 is BOOKING_A1B and
    // must not have moved. Payment is per BOOKING, and this is what that means
    // on a per-passenger manifest.
    expect(await paymentBySeat()).toEqual({ "1": "paid", "2": "paid", "3": "unpaid" });

    const { data: other } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_A1B).single();
    expect(other!.payment_status).toBe("unpaid");
  });

  it("is idempotent, and reversible back to unpaid", async () => {
    const again = okData(
      (await call(opA, "set_booking_payment_status", {
        p_booking_id: BOOKING_A1,
        p_payment_status: "paid",
      })) as Envelope<{ paymentStatus: string }>,
    );
    expect(again.paymentStatus).toBe("paid");

    // Reversible by design: an operator mis-tapping at a counter must be able to
    // put it back, and a refund needs somewhere to be recorded.
    const back = okData(
      (await call(opA, "set_booking_payment_status", {
        p_booking_id: BOOKING_A1,
        p_payment_status: "unpaid",
      })) as Envelope<{ paymentStatus: string }>,
    );
    expect(back.paymentStatus).toBe("unpaid");
    expect(await paymentBySeat()).toEqual({ "1": "unpaid", "2": "unpaid", "3": "unpaid" });
  });

  it("ANOTHER COMPANY's booking is NOT_FOUND, and stays untouched", async () => {
    // NOT_FOUND, never FORBIDDEN — FORBIDDEN would confirm the booking exists
    // and make this an oracle for other companies' PNRs (same rule as
    // operator_cancel_booking).
    const env = await call(opA, "set_booking_payment_status", {
      p_booking_id: BOOKING_B1,
      p_payment_status: "paid",
    });
    expect(errorOf(env).code).toBe("NOT_FOUND");

    const { data: booking } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_B1).single();
    expect(booking!.payment_status).toBe("unpaid");
  });

  it("an unknown booking is the same NOT_FOUND", async () => {
    const env = await call(opA, "set_booking_payment_status", {
      p_booking_id: "00000000-0000-4000-8000-000000000000",
      p_payment_status: "paid",
    });
    expect(errorOf(env).code).toBe("NOT_FOUND");
  });

  it("an unknown status is VALIDATION_ERROR, never a raw 23514", async () => {
    // The CHECK on the column would surface as SQLSTATE 23514 — a transport
    // failure with no §0 code. call() asserts the transport error is null, so
    // that half is covered before the code assertion runs.
    for (const status of ["refunded", "PAID", "", null]) {
      const env = await call(opA, "set_booking_payment_status", {
        p_booking_id: BOOKING_A1,
        p_payment_status: status,
      });
      expect(errorOf(env), `status ${JSON.stringify(status)}`).toMatchObject({
        code: "VALIDATION_ERROR",
        details: { field: "paymentStatus" },
      });
    }

    const { data: booking } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_A1).single();
    expect(booking!.payment_status, "no rejected value may have landed").toBe("unpaid");
  });

  it("a CANCELLED booking cannot be marked paid, but can be marked unpaid", async () => {
    // Arranged here rather than leaning on the cancel_trip case above, so this
    // holds however the file is filtered or reordered.
    await arrange(
      "cancel BOOKING_A2",
      svc.from("bookings").update({ status: "cancelled" }).eq("id", BOOKING_A2),
    );

    const env = await call(opA, "set_booking_payment_status", {
      p_booking_id: BOOKING_A2,
      p_payment_status: "paid",
    });
    expect(errorOf(env)).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "paymentStatus", reason: "cancelled" },
    });

    // There is no fare to collect on a dead ticket, and revenue on it would be
    // invisible to operator_summary / commissions_by_month, which both exclude
    // cancelled bookings.
    const { data: booking } = await svc
      .from("bookings").select("payment_status").eq("id", BOOKING_A2).single();
    expect(booking!.payment_status).toBe("unpaid");

    // The refund direction is allowed.
    const refunded = okData(
      (await call(opA, "set_booking_payment_status", {
        p_booking_id: BOOKING_A2,
        p_payment_status: "unpaid",
      })) as Envelope<{ paymentStatus: string; status: string }>,
    );
    expect(refunded).toMatchObject({ paymentStatus: "unpaid", status: "cancelled" });
  });
});

// ===========================================================================
describe("operator_cancel_booking", () => {
  it("frees the seat with no time window, and is idempotent", async () => {
    const first = okData(
      (await call(opA, "operator_cancel_booking", { p_booking_id: BOOKING_A1B })) as Envelope<{
        status: string;
      }>,
    );
    expect(first.status).toBe("cancelled");

    const { data: pax } = await svc
      .from("booking_passengers").select("active").eq("booking_id", BOOKING_A1B);
    expect((pax ?? []).every((p) => p.active === false)).toBe(true);

    // Re-cancelling is not an error.
    const second = await call(opA, "operator_cancel_booking", { p_booking_id: BOOKING_A1B });
    expect(second.ok).toBe(true);
  });
});

// ===========================================================================
describe("buses", () => {
  it("layout is immutable once the bus has a published trip", async () => {
    const env = await call(opA, "update_bus", {
      p_bus_id: BUS_A,
      p_layout: { rows: 2, cols: 2, aisleAfterCol: 1 },
    });
    const err = errorOf(env);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.details).toMatchObject({ reason: "layout_immutable" });
    expect(Number(err.details!.publishedTrips)).toBeGreaterThan(0);

    const { data: bus } = await svc.from("buses").select("layout").eq("id", BUS_A).single();
    expect((bus!.layout as { rows: number }).rows).toBe(12);
  });

  it("non-layout edits still work on that bus", async () => {
    const data = okData(
      (await call(opA, "update_bus", { p_bus_id: BUS_A, p_bus_type: "عادي" })) as Envelope<{
        busType: string;
      }>,
    );
    expect(data.busType).toBe("عادي");
    await call(opA, "update_bus", { p_bus_id: BUS_A, p_bus_type: "VIP" }); // restore
  });

  it("create_bus validates the layout the seat map depends on", async () => {
    const env = await call(opA, "create_bus", {
      p_plate_number: "OPRSCRATCH-BAD",
      p_bus_type: "VIP",
      p_layout: { rows: 12, cols: 4 }, // aisleAfterCol missing
    });
    expect(errorOf(env)).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "layout" },
    });
  });

  it("create_bus then allows a layout change while it has no published trip", async () => {
    const created = okData(
      (await call(opA, "create_bus", {
        p_plate_number: "OPRSCRATCH-NEW",
        p_bus_type: "VIP",
        p_layout: { rows: 10, cols: 4, aisleAfterCol: 2 },
      })) as Envelope<{ id: string }>,
    );
    createdBusIds.push(created.id);

    const updated = okData(
      (await call(opA, "update_bus", {
        p_bus_id: created.id,
        p_layout: { rows: 8, cols: 4, aisleAfterCol: 2 },
      })) as Envelope<{ layout: { rows: number } }>,
    );
    expect(updated.layout.rows).toBe(8);
  });
});

// ===========================================================================
describe("operator_summary", () => {
  it("uses the SNAPSHOTTED commission_rate, not the company's current rate", async () => {
    const data = okData(
      (await call(opA, "operator_summary", {
        p_from_date: summaryDate,
        p_to_date: summaryDate,
      })) as Envelope<Record<string, number | null>>,
    );

    // BOOKING_A1B was cancelled by the operator_cancel_booking case above, so
    // only BOOKING_A1 (100000 @ 0.10) is still confirmed on TRIP_A1 that day.
    expect(data.bookings).toBe(1);
    expect(data.revenue).toBe(100000);

    // THE ASSERTION. 100000 × 0.10 (snapshot) = 10000.
    // 100000 × COMPANY_A_RATE (its CURRENT rate) would differ — proving the
    // function reads bookings.commission_rate, without mutating any seeded row.
    expect(data.commission).toBe(10000);
    expect(data.commission).not.toBe(Math.round(100000 * COMPANY_A_RATE));
    expect(data.net).toBe(90000);

    // Cancelled bookings leave both the money and the occupancy.
    expect(data.seatsOccupied).toBe(2); // seats 1+2; seat 3's booking is cancelled
    expect(data.occupancyRate).toBeGreaterThan(0);
    expect(data.occupancyRate).toBeLessThanOrEqual(1);
  });

  it("an empty range reports zeros and a null occupancyRate, not a divide-by-zero", async () => {
    const data = okData(
      (await call(opA, "operator_summary", {
        p_from_date: "2020-01-01",
        p_to_date: "2020-01-02",
      })) as Envelope<Record<string, number | null>>,
    );
    expect(data).toMatchObject({ trips: 0, bookings: 0, revenue: 0, commission: 0, net: 0 });
    expect(data.occupancyRate).toBeNull();
  });

  it("rejects an inverted range", async () => {
    const env = await call(opA, "operator_summary", {
      p_from_date: "2026-05-10",
      p_to_date: "2026-05-01",
    });
    expect(errorOf(env)).toMatchObject({
      code: "VALIDATION_ERROR",
      details: { field: "toDate" },
    });
  });

  it("operator B's summary cannot see operator A's money", async () => {
    const a = okData(
      (await call(opA, "operator_summary", { p_from_date: summaryDate, p_to_date: summaryDate })) as Envelope<Record<string, number>>,
    );
    const b = okData(
      (await call(opB, "operator_summary", { p_from_date: summaryDate, p_to_date: summaryDate })) as Envelope<Record<string, number>>,
    );
    // B has its own booking on TRIP_B1 that day, at its own snapshotted rate.
    expect(b.revenue).toBe(50000);
    expect(b.commission).toBe(Math.round(50000 * 0.25));
    expect(a.revenue).not.toBe(b.revenue);
  });
});
