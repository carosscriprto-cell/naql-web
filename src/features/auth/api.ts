import { ApiError } from "@/lib/api-error";
import type { NaqlClient } from "@/lib/rpc";
import { browserClient } from "@/lib/supabase/browser";
import {
  isOperator,
  sessionClaimsSchema,
  type LoginFormValues,
  type SessionIdentity,
} from "./schemas";

// OPR-0 — operator sign-in (BACKEND_V1 §1: email + password, accounts seeded by
// an admin, no self-signup). Passengers are untouched by this file: they stay
// anonymous sessions created at the first lock attempt.

/**
 * Read the verified identity of whoever the given client is signed in as, or
 * `null` for no session.
 *
 * `getClaims()` rather than `getSession()`: it verifies the JWT signature
 * (locally against the cached JWKS when the project signs asymmetrically) and
 * returns the CUSTOM claims. `getUser()` would authenticate the token but hands
 * back the user record, which carries no `user_role` — the hook writes that
 * into the token only. A cookie is attacker-controlled input, so nothing here
 * may trust a decode that skips verification.
 *
 * The client is an explicit argument, matching `lib/rpc.ts`: the same read runs
 * as the browser session, as the cookie session in a Server Component, and as
 * the request's cookies inside `proxy.ts`.
 */
export async function readIdentity(
  client: NaqlClient,
): Promise<SessionIdentity | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data) return null;

  const parsed = sessionClaimsSchema.safeParse(data.claims);
  if (!parsed.success) return null;

  return {
    userId: parsed.data.sub,
    email: parsed.data.email ?? null,
    role: parsed.data.user_role,
    companyId: parsed.data.company_id ?? null,
  };
}

/**
 * Sign in and admit only operators.
 *
 * A successful password check is not the same as access: an admin account and a
 * passenger's anonymous session both authenticate fine and neither belongs in
 * /operator. A non-operator is signed straight back out, so the browser is not
 * left holding a session the guard will bounce on every navigation.
 *
 * NOTE — one session per browser: `@supabase/ssr` persists a single session in
 * the tab's cookies, so signing in here REPLACES any anonymous passenger
 * identity in that browser. The passenger's own bookings are still reachable by
 * PNR + phone (§4), but رحلاتي on that device is not. Expected: an operator
 * device is not a passenger device.
 */
export async function signIn(
  values: LoginFormValues,
): Promise<SessionIdentity> {
  const client = browserClient();

  const { error } = await client.auth.signInWithPassword({
    email: values.email,
    password: values.password,
  });
  if (error) {
    // 4xx is an ANSWER ("no"), and answers are domain errors (§0). Anything
    // else — offline, 5xx — is a transport failure and keeps NETWORK_ERROR,
    // which is not a §0 code because it means "no answer at all".
    const status = error.status ?? 0;
    const code = status >= 400 && status < 500 ? "UNAUTHORIZED" : "NETWORK_ERROR";
    throw new ApiError(code, error.message, { status, authCode: error.code });
  }

  const identity = await readIdentity(client);
  if (!isOperator(identity)) {
    await client.auth.signOut();
    throw new ApiError(
      "FORBIDDEN",
      `role ${identity?.role ?? "unknown"} is not an operator`,
    );
  }

  return identity;
}

export async function signOut(): Promise<void> {
  await browserClient().auth.signOut();
}
