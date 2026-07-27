import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
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
