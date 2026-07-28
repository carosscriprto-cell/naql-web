/**
 * T-PERF-2 — lock_seats burst with mixed conflicting seats.
 * Target: p95 < 200ms and correctness holds under load
 * (docs/V1_TEST_PLAN.md §8, launch gate).
 *
 * WHAT "CORRECTNESS" MEANS HERE. The exactly-one guarantee is proved
 * DETERMINISTICALLY by tests/db/concurrency.test.ts ("10 parallel locks on the
 * same seat → exactly 1 ok, 9 SEAT_ALREADY_LOCKED"), which is the merge gate.
 * A load test cannot prove it better — it can only show the guarantee does not
 * DEGRADE under pressure. So every response here must be a well-formed §0
 * envelope carrying either a lockId or one of the two conflict codes: never a
 * 5xx, never a raw SQL error leaking through, never an ok without a lockId, and
 * never a conflict whose details.seats omits the seat that was asked for.
 * A deadlock or a lost advisory lock would surface as a timeout or a 5xx, both
 * of which fail the thresholds below.
 *
 *   k6 run -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... tools/load/lock-seats.js
 *
 * RATE LIMIT. lock_seats needs auth.uid(), so setup() mints anonymous sessions.
 * Hosted DEV caps anonymous sign-ins at ~30/hour/IP, so SESSIONS defaults to 20
 * and the VUs share them. Prefer the CI local stack (no cap) for a full run;
 * against DEV, one run per hour. See README → "Load tests".
 */
import http from "k6/http";
import { check, fail } from "k6";
import { Rate } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
// Seeded القدموس دمشق→اللاذقية, n=9 — 48 seats, no bookings (supabase/seed.sql).
const TRIP_ID = __ENV.TRIP_ID || "000000e1-0000-4000-8000-000000000009";
const SESSIONS = Number(__ENV.SESSIONS || 20);

// A deliberately SMALL pool against a 48-seat bus: the point is contention, so
// VUs must collide often. Widen it to measure the uncontended path instead.
const SEAT_POOL = (__ENV.SEATS || "1,2,3,4,5,6").split(",");

if (!SUPABASE_URL || !ANON_KEY) {
  fail("SUPABASE_URL and SUPABASE_ANON_KEY are required (see README → Load tests)");
}

const invariant = new Rate("envelope_invariant_held");
const lockWon = new Rate("lock_acquired");

export const options = {
  scenarios: {
    burst: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 100), // requests per second
      timeUnit: "1s",
      duration: __ENV.DURATION || "30s",
      preAllocatedVUs: 50,
      maxVUs: 200,
    },
  },
  thresholds: {
    "http_req_duration{name:lock_seats}": ["p(95)<200"],
    http_req_failed: ["rate==0"],
    // The correctness gate: not one malformed or unexpected response.
    envelope_invariant_held: ["rate==1"],
  },
};

const json = (token) => ({
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
});

export function setup() {
  const tokens = [];
  for (let i = 0; i < SESSIONS; i++) {
    // Supabase anonymous sign-in is POST /auth/v1/signup with an empty body.
    const res = http.post(`${SUPABASE_URL}/auth/v1/signup`, JSON.stringify({}), {
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    });
    if (res.status !== 200) {
      fail(
        `anonymous sign-in ${i + 1}/${SESSIONS} failed (${res.status}): ${res.body}. ` +
          "On hosted DEV this is usually the ~30/hour/IP sign-in cap — lower -e SESSIONS, " +
          "wait an hour, or run against the CI local stack.",
      );
    }
    const token = res.json("access_token");
    if (!token) fail(`anonymous sign-in returned no access_token: ${res.body}`);
    tokens.push(token);
  }
  return { tokens };
}

// Named, not anonymous: k6 accepts either, and the name shows up in traces.
export default function burstLockSeats(data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const seat = SEAT_POOL[Math.floor(Math.random() * SEAT_POOL.length)];

  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/lock_seats`,
    JSON.stringify({
      p_trip_id: TRIP_ID,
      p_seats: [{ seatNumber: seat, gender: "male" }],
    }),
    { ...json(token), tags: { name: "lock_seats" } },
  );

  let body = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }

  const held = check(res, {
    "status 200": (r) => r.status === 200,
    "well-formed envelope with the expected outcome": () => {
      if (!body || typeof body.ok !== "boolean") return false;
      if (body.ok) {
        // A win must carry a usable hold.
        return Boolean(body.data && body.data.lockId && body.data.expiresAt);
      }
      // A loss must be one of the two conflict codes, and must name the seat
      // that was actually requested — a conflict on some other seat would mean
      // the request/response correlation broke under load.
      const code = body.error && body.error.code;
      if (code !== "SEAT_ALREADY_LOCKED" && code !== "SEAT_ALREADY_BOOKED") return false;
      const seats = (body.error.details && body.error.details.seats) || [];
      return seats.indexOf(seat) !== -1;
    },
  });
  invariant.add(held);
  lockWon.add(Boolean(body && body.ok));

  // Release immediately so the pool keeps churning; otherwise the first
  // iteration locks every seat for the 10-minute TTL and the rest of the run
  // measures nothing but the conflict path.
  if (body && body.ok && body.data && body.data.lockId) {
    http.post(
      `${SUPABASE_URL}/rest/v1/rpc/release_lock`,
      JSON.stringify({ p_lock_id: body.data.lockId }),
      { ...json(token), tags: { name: "release_lock" } },
    );
  }
}

export function teardown(data) {
  // Best effort: drop anything the run left holding seats, so a subsequent
  // functional suite does not start against a half-locked bus.
  const token = data.tokens[0];
  http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_seat_map`,
    JSON.stringify({ p_trip_id: TRIP_ID }),
    json(token),
  );
}
