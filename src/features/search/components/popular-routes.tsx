import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getPopularRoutes } from "@/mocks/data";

export function PopularRoutes() {
  const t = useTranslations("popularRoutes");
  const routes = getPopularRoutes();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-16 lg:pt-24">
      <h2 className="text-center text-2xl font-bold lg:text-3xl">
        {t("title")}
      </h2>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-6">
        {routes.map((route) => (
          <Link
            key={`${route.fromCity.slug}-${route.toCity.slug}`}
            href={`/search?from=${route.fromCity.slug}&to=${route.toCity.slug}`}
            className="group focus-visible:ring-ring/50 rounded-4xl focus-visible:ring-3 focus-visible:outline-none"
          >
            <Card
              size="sm"
              className="group-hover:ring-primary/30 h-full transition-colors"
            >
              <CardContent className="flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {route.fromCity.nameAr}
                  <ArrowLeftIcon
                    className="text-primary size-4 shrink-0 transition-transform group-hover:-translate-x-0.5"
                    aria-hidden
                  />
                  {route.toCity.nameAr}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t("fromPrice", { price: route.minPrice })}
                </p>
                <Badge variant="secondary" className="mt-1">
                  {t("tripsPerDay", { count: route.tripsPerDay })}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
