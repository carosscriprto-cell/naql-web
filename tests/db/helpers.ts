import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

export type { SupabaseClient } from "@supabase/supabase-js";

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

function newClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ===========================================================================
// Anonymous sign-in with backoff. signInAnonymously() is rate-limited on the
// hosted project (default 30/hour/IP), so the raw call is wrapped in a retry
// and every real sign-in is counted for reporting.
// ===========================================================================
const RATE_LIMIT_MESSAGE =
  "Anonymous sign-in rate limit hit on the hosted DEV project. Raise it in the dashboard " +
  "(Authentication → Rate Limits) or wait. CI runs a local stack and has no such ceiling.";

let realSignIns = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(error: unknown): boolean {
  const e = error as { status?: number; code?: string; message?: string } | null;
  if (!e) return false;
  const msg = String(e.message ?? "").toLowerCase();
  const code = String(e.code ?? "").toLowerCase();
  return e.status === 429 || msg.includes("rate limit") || code.includes("rate");
}

function isTransient(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | null;
  if (!e) return false;
  const msg = String(e.message ?? "").toLowerCase();
  return (
    (typeof e.status === "number" && e.status >= 500) ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

async function signInAnonymouslyWithRetry(
  client: SupabaseClient,
  label: string,
): Promise<Session> {
  const delays = [1000, 2000, 4000]; // 3 attempts, exponential backoff
  let lastError: unknown = null;
  for (let attempt = 0; attempt < delays.length; attempt++) {
    const { data, error } = await client.auth.signInAnonymously();
    if (!error && data.session) {
      realSignIns++;
      console.warn(`[anon-pool] real signInAnonymously (${label}) #${realSignIns}`);
      return data.session;
    }
    lastError = error;
    // A definitive failure (e.g. anonymous sign-ins disabled) will not fix
    // itself — fail fast instead of burning the backoff budget.
    if (!isRateLimit(error) && !isTransient(error)) break;
    await sleep(delays[attempt]);
  }
  if (isRateLimit(lastError)) throw new Error(RATE_LIMIT_MESSAGE);
  const msg = (lastError as { message?: string } | null)?.message ?? "unknown error";
  throw new Error(`signInAnonymously failed (${label}): ${msg}`);
}

process.on("exit", () => {
  if (realSignIns > 0) {
    console.log(`[anon-pool] real anonymous sign-ins this run: ${realSignIns}`);
  }
});

// ===========================================================================
// Cached anonymous-session pool. Distinct anonymous identities are expensive
// (rate-limited sign-ins), so we mint each "slot" once and reuse it across runs
// via its refresh token. A slot only costs a real sign-in on the very first run
// (cold cache) or after `db:reset` wipes auth.users (refresh then fails).
// Cache lives under node_modules/.cache (gitignored) and holds tokens — DEV only.
// ===========================================================================
type Slot = {
  index: number;
  user_id: string;
  refresh_token: string;
  access_token?: string;
  expires_at?: number; // unix seconds
};

const CACHE_DIR = resolve(process.cwd(), "node_modules/.cache");
const CACHE_FILE = resolve(CACHE_DIR, "naql-anon-sessions.json");

function loadCache(): Map<number, Slot> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Slot[];
    return new Map(raw.map((s) => [s.index, s]));
  } catch {
    return new Map();
  }
}

const cache = loadCache();

// Serialize writes so concurrent pooledAnonClient() calls (e.g. Promise.all over
// slots 0..9) never tear the cache file. Each persist writes the full map.
let writeChain: Promise<void> = Promise.resolve();
function persist(): Promise<void> {
  const snapshot = JSON.stringify([...cache.values()], null, 2);
  writeChain = writeChain.then(() => writeFile(CACHE_FILE, snapshot)).catch(() => {});
  return writeChain;
}

function storeSlot(index: number, session: Session): Promise<void> {
  cache.set(index, {
    index,
    user_id: session.user.id,
    refresh_token: session.refresh_token,
    access_token: session.access_token,
    expires_at: session.expires_at,
  });
  return persist();
}

/**
 * A Supabase client for a stable anonymous "slot". Reused across runs:
 *   1. valid cached access token → setSession() locally, ZERO network calls;
 *   2. else cached refresh token → refreshSession() (a token refresh, NOT an
 *      anonymous sign-in, so it does not touch the sign-in rate limit);
 *   3. else (cold slot, or db:reset invalidated the token) → one real
 *      signInAnonymously() and the slot is (re)written.
 * Distinct indices map to distinct persistent users.
 */
export async function pooledAnonClient(index: number): Promise<SupabaseClient> {
  const client = newClient();
  const slot = cache.get(index);

  if (slot) {
    // 1. Local restore if the access token is still comfortably valid.
    if (slot.access_token && slot.expires_at && slot.expires_at * 1000 - Date.now() > 60_000) {
      const { error } = await client.auth.setSession({
        access_token: slot.access_token,
        refresh_token: slot.refresh_token,
      });
      if (!error) return client;
    }
    // 2. Token refresh (not a sign-in). Rotated refresh token is re-stored.
    const { data, error } = await client.auth.refreshSession({
      refresh_token: slot.refresh_token,
    });
    if (!error && data.session) {
      await storeSlot(index, data.session);
      return client;
    }
    // else fall through — token dead (expired, or db:reset wiped the user).
  }

  // 3. Cold slot / dead token → mint (or re-mint) this identity.
  const session = await signInAnonymouslyWithRetry(client, `slot ${index}`);
  await storeSlot(index, session);
  return client;
}

/** Manual escape hatch: forget every cached session. Nothing calls this. */
export function clearAnonSessionCache(): void {
  cache.clear();
  try {
    rmSync(CACHE_FILE, { force: true });
  } catch {
    /* ignore */
  }
}

/**
 * A BRAND-NEW anonymous session (its own auth.uid()), created every call. Use
 * only where freshness is the point (e.g. the smoke test that anon sign-in
 * works). For distinct-but-reusable identities, prefer pooledAnonClient().
 */
export async function anonClient(): Promise<SupabaseClient> {
  const client = newClient();
  await signInAnonymouslyWithRetry(client, "fresh");
  return client;
}

/**
 * An anon-key client WITHOUT a session — a true unauthenticated caller
 * (no auth.uid()). Use for RLS "public read" / "no auth" assertions.
 */
export function publicClient(): SupabaseClient {
  return newClient();
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
