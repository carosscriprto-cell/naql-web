import Link from "next/link";
import { BusFrontIcon, StarIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Card, CardContent } from "@/components/ui/card";
import { companies } from "@/mocks/data";

export function Partners() {
  const t = useTranslations("partners");

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 lg:py-24">
      <h2 className="text-center text-2xl font-bold lg:text-3xl">
        {t("title")}
      </h2>
      <div className="mt-8 grid gap-4 sm:grid-cols-3 lg:gap-6">
        {companies.map((company) => (
          <Link
            key={company.id}
            href={`/companies/${company.slug}`}
            className="group focus-visible:ring-ring/50 rounded-4xl focus-visible:ring-3 focus-visible:outline-none"
          >
            <Card className="group-hover:ring-primary/30 h-full transition-colors">
              <CardContent className="flex flex-col items-center gap-3 text-center">
                <span className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
                  <BusFrontIcon className="size-6" aria-hidden />
                </span>
                <p className="text-base font-semibold">{company.name}</p>
                <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                  <span className="text-foreground flex items-center gap-1 font-medium">
                    <StarIcon
                      className="size-4 fill-amber-400 text-amber-400"
                      aria-hidden
                    />
                    {company.rating}
                  </span>
                  ·<span>{t("tripsCount", { count: company.tripsCount })}</span>
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
