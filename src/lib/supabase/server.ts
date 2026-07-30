import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";
import { supabaseCredentials } from "./credentials";

/**
 * TRUST BOUNDARY: anon key **with the caller's cookie session**.
 *
 * Server-side equivalent of `./browser` — RLS and every `auth.uid()` /
 * `auth.jwt()` check inside the RPCs run as the logged-in user. This is the
 * client for the Phase D `/operator` area (manifests, scoped by `company_id`
 * from the custom access token hook) and for anything else server-rendered
 * that must be scoped to the caller rather than public.
 *
 * A fresh client per request — never hoist it to a module constant, or one
 * request's session leaks into another's. `cookies()` is async in Next 16, so
 * this function is too.
 *
 * NOTE: `setAll` is a no-op from Server Components (cookies are read-only once
 * rendering starts), so this client cannot renew a session whose access token
 * expires mid-visit. `src/proxy.ts` (F3a) does that refresh ahead of every
 * /operator request — Next 16 renamed the `middleware` convention to `proxy`.
 */
export async function serverClient(): Promise<SupabaseClient<Database>> {
  const { url, anonKey } = supabaseCredentials();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Thrown when called during Server Component rendering. Safe to
          // ignore there; Route Handlers and Server Functions can still write.
        }
      },
    },
  });
}
