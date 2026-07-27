/**
 * QA helper (B4/M4): force a seat lock to expire NOW, using the service role, so
 * the frontend's LOCK_EXPIRED flow (countdown hits zero → checkout is rejected)
 * is reproducible on the hosted DEV project without waiting out the 10-minute TTL.
 *
 * Usage (loads .env.test for SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   npx tsx tools/qa/shorten-lock.ts <lockId>
 *   npx tsx tools/qa/shorten-lock.ts --trip <tripId>     # newest lock on that trip
 *   npx tsx tools/qa/shorten-lock.ts --trip <tripId> --in 30   # expire in 30s instead
 *
 * The lock ROW is kept (only expires_at moves), which is what makes this useful:
 * create_booking still finds the lock and rejects it with LOCK_EXPIRED, exactly
 * as it would after a real timeout. Deleting the row would exercise the same
 * code path but not the same state.
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

const USAGE =
  "Usage:\n" +
  "  npx tsx tools/qa/shorten-lock.ts <lockId>\n" +
  "  npx tsx tools/qa/shorten-lock.ts --trip <tripId> [--in <seconds>]";

function parseArgs(argv: string[]) {
  let lockId: string | undefined;
  let tripId: string | undefined;
  let inSeconds = -60; // default: already expired a minute ago

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--trip") {
      tripId = argv[++i];
    } else if (arg === "--in") {
      const seconds = Number(argv[++i]);
      if (!Number.isFinite(seconds)) throw new Error(`--in expects a number\n${USAGE}`);
      inSeconds = seconds;
    } else if (!arg.startsWith("--")) {
      lockId = arg;
    } else {
      throw new Error(`Unknown flag ${arg}\n${USAGE}`);
    }
  }

  if (!lockId && !tripId) throw new Error(`Give a lockId or --trip <tripId>.\n${USAGE}`);
  return { lockId, tripId, inSeconds };
}

async function main() {
  const { lockId, tripId, inSeconds } = parseArgs(process.argv.slice(2));

  const svc = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let targetId = lockId;
  if (!targetId) {
    // Newest lock on the trip — the one the browser session is most likely holding.
    const { data, error } = await svc
      .from("seat_locks")
      .select("id,created_at")
      .eq("trip_id", tripId!)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(`Failed to read seat_locks: ${error.message}`);
    if (!data?.length) throw new Error(`No locks on trip ${tripId}. Hold some seats first.`);
    targetId = data[0].id as string;
  }

  const expiresAt = new Date(Date.now() + inSeconds * 1000).toISOString();
  const { data: updated, error } = await svc
    .from("seat_locks")
    .update({ expires_at: expiresAt })
    .eq("id", targetId)
    .select("id,trip_id,expires_at")
    .single();
  if (error || !updated) {
    throw new Error(`Failed to update lock ${targetId}: ${error?.message ?? "no row"}`);
  }

  const { data: seats } = await svc
    .from("seat_lock_seats")
    .select("seat_number")
    .eq("lock_id", targetId);

  console.log(
    `Lock ${updated.id} on trip ${updated.trip_id} now expires at ${updated.expires_at}\n` +
      `  seats: ${(seats ?? []).map((s) => s.seat_number).join(", ") || "(none)"}\n` +
      (inSeconds < 0
        ? "  It is ALREADY expired: get_seat_map frees those seats and create_booking returns LOCK_EXPIRED."
        : `  It expires in ${inSeconds}s — watch the checkout countdown run out.`),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
