import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function OperatorCta() {
  const t = useTranslations("operatorCta");

  return (
    <section className="bg-linear-to-l from-teal-900 to-teal-700 py-16 lg:py-20">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-4 text-center lg:flex-row lg:justify-between lg:text-start">
        <div>
          <h2 className="text-2xl font-bold text-white lg:text-3xl">
            {t("title")}
          </h2>
          <p className="mt-2 max-w-xl text-teal-50/90">{t("subtitle")}</p>
        </div>
        <Button
          size="lg"
          className="shrink-0 bg-white text-teal-800 hover:bg-teal-50"
          render={<Link href="/operator" />}
        >
          {t("button")}
        </Button>
      </div>
    </section>
  );
}
