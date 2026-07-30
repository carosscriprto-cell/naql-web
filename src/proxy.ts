import { NextResponse, type NextRequest } from "next/server";

import { readIdentity } from "@/features/auth/api";
import { isOperator, safeOperatorPath } from "@/features/auth/schemas";
import { proxyClient } from "@/lib/supabase/proxy";

// OPR-0 — the /operator guard, and the session refresh the whole area depends
// on. `proxy.ts`, not `middleware.ts`: the middleware file convention is
// deprecated and renamed in Next 16 (node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md). Node runtime by default.
//
// Running before the render is the point. A Server Component that redirected on
// its own would already have started streaming the shell, which is the "data
// flash" this task forbids; here the visitor never receives a byte of /operator.
// It is not the only check, though — Next's own proxy docs warn that a matcher
// change silently removes coverage, so every page re-verifies through
// `requireOperator()`.

const LOGIN_PATH = "/operator/login";

export async function proxy(request: NextRequest) {
  const { client, response } = proxyClient(request);

  const identity = await readIdentity(client);
  const { pathname, search } = request.nextUrl;
  const onLoginPage = pathname === LOGIN_PATH;

  if (!isOperator(identity)) {
    if (onLoginPage) return response();
    // Remember where they were headed so login can finish the journey.
    const target = new URL(LOGIN_PATH, request.url);
    target.searchParams.set("next", `${pathname}${search}`);
    return redirectKeepingCookies(target, response());
  }

  if (onLoginPage) {
    const next = safeOperatorPath(request.nextUrl.searchParams.get("next"));
    return redirectKeepingCookies(new URL(next, request.url), response());
  }

  return response();
}

/**
 * A redirect is a fresh response, so any session cookie the auth call just
 * rotated lives on the one being discarded. Dropping it would invalidate the
 * old refresh token without ever storing the new one — an immediate logout, and
 * only for users whose token happened to expire on a guarded request.
 */
function redirectKeepingCookies(target: URL, carrier: NextResponse) {
  const redirect = NextResponse.redirect(target);
  for (const cookie of carrier.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

// Only the portal. The passenger flow must never pay for an auth round trip,
// and a broad matcher would also put one in front of every static asset.
export const config = {
  matcher: ["/operator", "/operator/:path*"],
};
