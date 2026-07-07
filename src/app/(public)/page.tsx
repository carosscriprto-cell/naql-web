import { useTranslations } from "next-intl";

import { HowItWorks } from "@/components/shared/how-it-works";
import { OperatorCta } from "@/components/shared/operator-cta";
import { Partners } from "@/components/shared/partners";
import { StatsStrip } from "@/components/shared/stats-strip";
import { PopularRoutes } from "@/features/search/components/popular-routes";
import { SearchForm } from "@/features/search/components/search-form";

export default function HomePage() {
  const t = useTranslations("home.hero");

  return (
    <>
      <section className="bg-linear-to-b from-teal-900 to-teal-700 pt-16 pb-28 lg:pt-24 lg:pb-36">
        <div className="mx-auto w-full max-w-6xl px-4 text-center text-white">
          <h1 className="text-3xl leading-snug font-bold lg:text-5xl lg:leading-snug">
            {t("title")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-teal-50/90 lg:text-lg">
            {t("subtitle")}
          </p>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-16 w-full max-w-5xl px-4 lg:-mt-20">
        <SearchForm />
      </div>

      <PopularRoutes />
      <HowItWorks />
      <StatsStrip />
      <Partners />
      <OperatorCta />
    </>
  );
}
