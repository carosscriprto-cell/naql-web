import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Credentials come from the environment, loaded from .env.test by
// vitest.db.config.ts. No fallbacks: against a hosted project, a stale local
// demo key produces confusing auth failures instead of an obvious "missing
// config" error.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing env var ${name}. Set it in .env.test (see .env.example) — it must point at the hosted DEV Supabase project.`,
    );
  }
  return value;
}

const SUPABASE_URL = required("SUPABASE_URL");
const ANON_KEY = required("SUPABASE_ANON_KEY");
const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");

/**
 * A fresh anonymous passenger session (own auth.uid()). Each call signs in a
 * brand-new anonymous user, so concurrency tests get genuinely distinct
 * identities. Requires anonymous sign-ins enabled on the project (dashboard
 * setting on the hosted DEV project; config.toml only applies to CI's local stack).
 */
export async function anonClient(): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`signInAnonymously failed: ${error.message}`);
  return client;
}

/**
 * An anon-key client WITHOUT a session — a true unauthenticated caller
 * (no auth.uid()). Use for RLS "public read" / "no auth" assertions.
 */
export function publicClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Service-role client — bypasses RLS. Used to arrange test state (expire a
 * lock, suspend a company, etc.) that no public RPC exposes.
 */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * DB reset note: tests assume a freshly reset DB. CI resets its local stack
 * before `vitest run`; locally, run `npm run db:reset` (targets the linked DEV
 * project — check `npm run db:whoami` first). We never reset inside the test process.
 */
export const resetDb = () => {
  throw new Error(
    "resetDb() is not called from tests. Run `supabase db reset` before the suite (CI does this).",
  );
};
