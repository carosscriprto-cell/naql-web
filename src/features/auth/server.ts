import { cache } from "react";
import { redirect } from "next/navigation";

import { serverClient } from "@/lib/supabase/server";
import { readIdentity } from "./api";
import { isOperator, type SessionIdentity } from "./schemas";

// Server-only half of the auth feature. Never import this from a Client
// Component: `serverClient()` reads `next/headers`.

/**
 * The current identity, resolved once per request.
 *
 * `cache()` is what makes the layout and the page it wraps both able to ask
 * without paying twice: on a project signing JWTs with a symmetric secret,
 * `getClaims()` falls back to a round trip to the Auth server, so an uncached
 * helper would put two network calls in front of every operator screen.
 */
export const currentIdentity = cache(
  async (): Promise<SessionIdentity | null> => readIdentity(await serverClient()),
);

/**
 * Admit an operator or send them to login — the in-app half of the guard.
 *
 * `proxy.ts` already redirects, and this repeats the check on purpose: Next's
 * own proxy documentation warns that a matcher change or a moved Server
 * Function silently removes proxy coverage, so authorization is verified again
 * where the data is actually read. Call it from every /operator PAGE; the
 * layout cannot, because it also wraps the login page and would loop.
 */
export async function requireOperator(): Promise<
  SessionIdentity & { companyId: string }
> {
  const identity = await currentIdentity();
  if (!isOperator(identity)) redirect("/operator/login");
  return identity;
}
