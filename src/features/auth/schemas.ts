import { z } from "zod";

/**
 * The subset of JWT claims the portal reads (BACKEND_V1 §1).
 *
 * `user_role` and `company_id` are injected by the Custom Access Token Hook in
 * `supabase/migrations/20260725202100_schema_rls_hook.sql`.
 *
 * THE CLAIM IS `user_role`, NOT `role`. GoTrue owns `role` and sets it to the
 * Postgres role PostgREST does `SET ROLE` on — it reads `authenticated` for an
 * operator, an admin and an anonymous passenger alike, so a guard written
 * against `role` lets every visitor into /operator. The hook exists precisely
 * because that claim could not be overwritten.
 *
 * Non-strict on purpose: a JWT carries a dozen standard claims that are none of
 * this app's business, and `user_role` falls back to the least-privileged value
 * rather than failing the parse, so an unrecognised role denies instead of
 * throwing at the guard.
 */
export const sessionClaimsSchema = z.object({
  sub: z.string(),
  email: z.string().optional(),
  user_role: z.enum(["passenger", "operator", "admin"]).catch("passenger"),
  // Present only for operators (`profiles_company_scope`: admins are global).
  company_id: z.string().optional(),
});

export type SessionRole = z.infer<typeof sessionClaimsSchema>["user_role"];

/** Who the current session is, in the app's own vocabulary. */
export type SessionIdentity = {
  userId: string;
  email: string | null;
  role: SessionRole;
  companyId: string | null;
};

/**
 * The single admission test for /operator.
 *
 * `companyId` is part of it, not an afterthought: every operator RPC scopes by
 * the `company_id` claim, so an operator without one would reach the portal and
 * then get FORBIDDEN or an empty manifest from every call behind it.
 */
export function isOperator(
  identity: SessionIdentity | null,
): identity is SessionIdentity & { companyId: string } {
  return identity?.role === "operator" && identity.companyId !== null;
}

/**
 * Sanitise a `?next=` destination before redirecting to it.
 *
 * The guard round-trips the path the visitor asked for through the URL, which
 * makes it attacker-supplied by the time it comes back. Only paths inside the
 * portal survive: `//evil.example` and `https://evil.example` both fail the
 * prefix test, and login itself is refused so a signed-in operator cannot be
 * bounced back to the form they just cleared.
 */
export function safeOperatorPath(
  value: string | null | undefined,
  fallback = "/operator",
): string {
  if (!value?.startsWith("/operator")) return fallback;
  if (value.startsWith("/operator/login")) return fallback;
  return value;
}

// Login form (OPR-0). Built per-render with the active translator so validation
// messages come from ar.json — mirrors buildCheckoutSchema.
type Translator = (key: string) => string;

export function buildLoginSchema(t: Translator) {
  return z.object({
    email: z.email(t("errors.emailInvalid")),
    password: z.string().min(1, t("errors.passwordRequired")),
  });
}

export type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;
