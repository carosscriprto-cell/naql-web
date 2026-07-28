/**
 * T-PERF-1 — get_seat_map under 200 concurrent viewers of one trip.
 * Target: p95 < 50ms, zero errors (docs/V1_TEST_PLAN.md §8, launch gate).
 *
 * This is the hot read of the whole product: every passenger sitting on a trip
 * page re-polls it every 15 seconds (CLAUDE.md), so its p95 is what the seat
 * map feels like under load.
 *
 *   k6 run -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... tools/load/seat-map.js
 *
 * See README → "Load tests" for pulling the env from .env.test.
 */
import http from "k6/http";
import { check, fail } from "k6";
import { Rate, Trend } from "k6/metrics";

const SUPABASE_URL = __ENV.SUPABASE_URL;
const ANON_KEY = __ENV.SUPABASE_ANON_KEY;
// Seeded القدموس دمشق→اللاذقية, n=9 — published, future, 48 free seats and no
// bookings (supabase/seed.sql). Override with -e TRIP_ID=... for a busier trip.
const TRIP_ID = __ENV.TRIP_ID || "000000e1-0000-4000-8000-000000000009";

if (!SUPABASE_URL || !ANON_KEY) {
  fail("SUPABASE_URL and SUPABASE_ANON_KEY are required (see README → Load tests)");
}

const envelopeOk = new Rate("envelope_ok");
const seatCount = new Trend("seats_returned");

export const options = {
  scenarios: {
    viewers: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 200),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    // The launch-gate numbers. k6 exits non-zero if either is missed, so this
    // script is usable as a CI gate as-is.
    "http_req_duration{scenario:viewers}": ["p(95)<50"],
    http_req_failed: ["rate==0"],
    envelope_ok: ["rate==1"],
  },
};

// Named, not anonymous: k6 accepts either, and the name shows up in traces.
export default function pollSeatMap() {
  const res = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_seat_map`,
    JSON.stringify({ p_trip_id: TRIP_ID }),
    {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "Content-Type": "application/json",
      },
      tags: { name: "get_seat_map" },
    },
  );

  // A 200 is not success on its own: get_seat_map is ENVELOPED (§3), so a
  // NOT_FOUND for a mistyped trip id would still be HTTP 200 and would
  // otherwise show up as a clean, fast, meaningless run.
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "envelope ok:true": (r) => {
      try {
        return r.json("ok") === true;
      } catch {
        return false;
      }
    },
  });
  envelopeOk.add(ok);

  if (ok) {
    const seats = res.json("data.seats");
    seatCount.add(Array.isArray(seats) ? seats.length : 0);
  }
}
