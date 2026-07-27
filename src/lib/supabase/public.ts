import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { supabaseCredentials } from "./credentials";

/**
 * TRUST BOUNDARY: anon key, **no session, ever**.
 *
 * `auth.uid()` is null on every call, so this client sees exactly what a
 * logged-out visitor sees. That is the point: it is for server-rendered public
 * pages (route pages that need data at render time for SEO — trip details,
 * company pages), where reading as "whoever happened to be signed in" would
 * both leak scoped data into a cached page and produce a page that differs
 * per visitor.
 *
 * Never use it for locks, bookings, or رحلاتي — those RPCs return
 * `UNAUTHORIZED` without an `auth.uid()`, by design (BACKEND_V1 §3).
 *
 * Session-less means stateless, so one instance is safe to share across
 * requests.
 */
let cached: SupabaseClient<Database> | null = null;

export function publicClient(): SupabaseClient<Database> {
  if (cached) return cached;
  const { url, anonKey } = supabaseCredentials();
  cached = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cached;
}
