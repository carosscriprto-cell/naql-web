import { getTranslations } from "next-intl/server";

import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { isOperator } from "@/features/auth/schemas";
import { currentIdentity } from "@/features/auth/server";

// The portal shell. Deliberately NOT the public site's layout: no Header, no
// Footer, no passenger navigation — an operator at a counter is doing one job.

export default async function OperatorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await currentIdentity();
  const t = await getTranslations("operator");

  // Signed out means this is the login page — `proxy.ts` redirects everything
  // else before it renders. The layout does NOT redirect, because it wraps the
  // login page too and would bounce it into a loop; the pages themselves
  // re-verify (`requireOperator`).
  if (!isOperator(identity)) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        {children}
      </main>
    );
  }

  return (
    <>
      <header className="bg-card border-border/60 flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{t("portalTitle")}</span>
          {identity.email ? (
            <span className="text-muted-foreground text-xs" dir="ltr">
              {identity.email}
            </span>
          ) : null}
        </div>
        <SignOutButton />
      </header>
      <main className="flex-1">{children}</main>
    </>
  );
}
