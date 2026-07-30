import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";
import { requireOperator } from "@/features/auth/server";

// The portal's landing page. Intentionally thin: F3a ships the door, not the
// rooms — trips and the manifest are F3b, QR scanning F3c. It exists so
// /operator is a real, guarded destination rather than a 404 that hides
// whether the guard worked.
export default async function OperatorHomePage() {
  const identity = await requireOperator();
  const t = await getTranslations("operator.home");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card>
        <CardContent className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          {identity.email ? (
            // The address stays LTR inside the RTL paragraph — an email
            // rendered RTL reorders around its dots and reads as a typo.
            <p className="text-muted-foreground flex flex-wrap gap-1 text-sm">
              {t("signedInAs")}
              <span dir="ltr">{identity.email}</span>
            </p>
          ) : null}
          <p className="text-muted-foreground text-sm">{t("soon")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
