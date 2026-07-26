/**
 * QA helper (QA-B-16): pre-lock seat "13" on a seeded trip using the service
 * role, so the frontend's lock-conflict UX is reproducible on the hosted DEV
 * project (the MSW build hardcodes seat 13 as the conflict trigger).
 *
 * Usage (loads .env.test for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   npx tsx tools/qa/prelock-seat-13.ts [tripId] [male|female]
 *
 * Defaults: tripId = seeded دمشق→حلب trip (n=1), gender = female.
 * Idempotent: any existing lock on seat 13 of that trip is released first.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.test" });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Set them in .env.test (see .env.example).",
  );
}

// Seed fixtures (supabase/seed.sql).
const DEFAULT_TRIP = "000000e1-0000-4000-8000-000000000001"; // الأمانة دمشق→حلب, n=1
const DEMO_PASSENGER = "000000db-0000-4000-8000-000000000001"; // seeded lock owner
const SEAT = "13";
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 3_600_000).toISOString();

async function main() {
  const tripId = process.argv[2] ?? DEFAULT_TRIP;
  const gender = (process.argv[3] ?? "female") as "male" | "female";
  if (gender !== "male" && gender !== "female") {
    throw new Error(`gender must be "male" or "female", got "${gender}"`);
  }

  const svc = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Release any existing lock holding seat 13 on this trip (idempotent).
  const { data: existing } = await svc
    .from("seat_lock_seats")
    .select("lock_id")
    .eq("trip_id", tripId)
    .eq("seat_number", SEAT);
  for (const row of existing ?? []) {
    await svc.from("seat_locks").delete().eq("id", row.lock_id);
  }

  const { data: lock, error: lockErr } = await svc
    .from("seat_locks")
    .insert({ trip_id: tripId, owner_id: DEMO_PASSENGER, expires_at: FAR_FUTURE })
    .select("id")
    .single();
  if (lockErr || !lock) throw new Error(`Failed to insert seat_locks: ${lockErr?.message}`);

  const { error: seatErr } = await svc.from("seat_lock_seats").insert({
    lock_id: lock.id,
    trip_id: tripId,
    seat_number: SEAT,
    gender,
  });
  if (seatErr) throw new Error(`Failed to insert seat_lock_seats: ${seatErr.message}`);

  console.log(
    `Locked seat ${SEAT} (${gender}) on trip ${tripId} until ${FAR_FUTURE}\n` +
      `  lockId=${lock.id}\n` +
      `Verify: get_seat_map(${tripId}) shows seat 13 as "locked".`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
