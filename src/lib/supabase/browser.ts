import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { ApiError } from "@/lib/api-error";
import { supabaseCredentials } from "./credentials";

/**
 * TRUST BOUNDARY: anon key **with a persisted session**.
 *
 * Every call is made as whoever the browser is signed in as — an anonymous
 * passenger (BACKEND_V1 §1: `signInAnonymously()` on the first lock attempt)
 * or, in Phase D, a logged-in operator. RLS and the `auth.uid()` checks inside
 * the RPCs see that identity, so this is the client any read or write that is
 * *supposed* to be scoped to the caller must use: locks, bookings, رحلاتي.
 *
 * Browser only. `@supabase/ssr` returns a singleton here, so the session is
 * shared across every caller in the tab; do not cache the result yourself.
 * On the server this silently degrades to a session-less client — that is the
 * bug this file's name exists to prevent. Server code wants `./server` (the
 * cookie session) or `./public` (deliberately no session).
 */
export function browserClient(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseCredentials();
  return createBrowserClient<Database>(url, anonKey);
}

/**
 * In-flight anonymous sign-in, shared by every concurrent caller.
 *
 * Module scope, not a ref: React StrictMode mounts effects twice and a
 * double-tapped متابعة fires two mutations, so two `lockSeats` calls can reach
 * `ensureSession()` before either finishes. Without this they would both see no
 * session and mint TWO anonymous users — the second silently replacing the
 * first, which orphans any lock the first already holds and burns two of the
 * ~30/hour/IP anonymous sign-in budget.
 */
let signingIn: Promise<void> | null = null;

/**
 * Guarantee a session exists before a write RPC, creating an anonymous one if
 * there is none (BACKEND_V1 §1).
 *
 * Call it from `lockSeats` and `createBooking` ONLY — never on page load and
 * never from a provider. §1 places identity creation at the FIRST LOCK ATTEMPT:
 * a visitor who only browses the seat map never gets an identity, which keeps
 * `get_seat_map` (granted to `anon`) free and leaves the sign-in rate limit for
 * people who are actually booking.
 *
 * Idempotent and safe to call on every write. The common case — a session
 * already exists — costs one local read and no network, because `getSession()`
 * reads the persisted session and only refreshes when the access token is stale.
 *
 * Browser only, like everything else in this file: on the server there is no
 * persisted session to find and this would mint an identity nobody can use.
 */
export async function ensureSession(): Promise<void> {
  const client = browserClient();

  const { data } = await client.auth.getSession();
  if (data.session) return;

  // A second caller that arrives while the first is signing in awaits the SAME
  // promise instead of starting its own sign-in.
  signingIn ??= (async () => {
    // Re-check inside the critical section: this caller may have queued behind a
    // sign-in that has since succeeded.
    const { data: fresh } = await client.auth.getSession();
    if (fresh.session) return;

    const { error } = await client.auth.signInAnonymously();
    if (error) {
      // UNAUTHORIZED (a §0 code) rather than NETWORK_ERROR: the request was
      // answered, and the answer was "you get no identity" — anonymous sign-ins
      // switched off in the dashboard, or the ~30/hour/IP cap reached. It is
      // also exactly what the write RPC would have returned had we let the call
      // through without a session, so the UI reaches the same branch either way.
      throw new ApiError(
        "UNAUTHORIZED",
        `anonymous sign-in failed: ${error.message}`,
        { status: error.status },
      );
    }
  })().finally(() => {
    // Cleared on failure too, so a retry is a fresh attempt and not a replay of
    // the rejected promise.
    signingIn = null;
  });

  return signingIn;
}
