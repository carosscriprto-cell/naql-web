import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";
import { supabaseCredentials } from "./credentials";

/**
 * TRUST BOUNDARY: anon key **with the request's cookie session, and the ability
 * to write cookies back**.
 *
 * The fourth client, and the only one that exists for a mechanical reason
 * rather than an identity one: it sees exactly what `./server` sees, but it
 * runs in `src/proxy.ts` — before rendering — which is the one place in a Next
 * app that can both read the session cookie and SET the rotated one. `./server`
 * cannot (cookies are read-only once a Server Component renders), so without
 * this the refresh token that supabase quietly rotates mid-visit is dropped and
 * the operator is logged out at an arbitrary moment.
 *
 * Returns the client together with a `response()` getter rather than a plain
 * response object: supabase decides *during* the auth call whether the session
 * needed refreshing, and only then are there cookies to carry. Callers must
 * return `response()` (or copy its cookies onto a redirect) — reading it before
 * the auth call returns an empty one.
 *
 * Proxy only. Nothing that renders should import this.
 */
export function proxyClient(request: NextRequest): {
  client: SupabaseClient<Database>;
  response: () => NextResponse;
} {
  const { url, anonKey } = supabaseCredentials();

  let response = NextResponse.next({ request });

  const client = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        // Written to BOTH sides: the request copy so the render that follows
        // sees the fresh token, the response so the browser stores it.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { client, response: () => response };
}
