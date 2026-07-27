import { env } from "@/config/env";

/**
 * Project URL + anon key, shared by all three trust-boundary clients.
 *
 * The anon key is public by design — RLS and the RPC auth checks are what
 * protect the data, not the key. The SERVICE ROLE key is the opposite and
 * NEVER appears anywhere under `src/`: it bypasses RLS entirely and lives only
 * in `.env.test` / CI (see `serviceClient()` in `tests/db/helpers.ts`).
 *
 * No fallbacks: against a hosted project a stale or missing value produces
 * confusing auth failures instead of an obvious "missing config" error.
 */
export function supabaseCredentials(): { url: string; anonKey: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Set both in .env.local (see .env.example) — they point at the hosted DEV project.",
    );
  }
  return { url, anonKey };
}
