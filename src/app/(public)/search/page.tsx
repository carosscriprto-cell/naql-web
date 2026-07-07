import { getTranslations } from "next-intl/server";

import { SearchFilters } from "@/features/search/components/search-filters";
import { SearchForm } from "@/features/search/components/search-form";
import { SearchResults } from "@/features/search/components/search-results";
import { SearchSummary } from "@/features/search/components/search-summary";

const asString = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : "";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const from = asString(params.from);
  const to = asString(params.to);
  const date = asString(params.date);
  const passengers = asString(params.passengers) || "1";
  const t = await getTranslations("searchPage");
  const hasParams = Boolean(from && to && date);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 lg:py-12">
      <h1 className="sr-only">{t("title")}</h1>
      {hasParams ? (
        <div className="flex flex-col gap-4">
          <SearchSummary
            from={from}
            to={to}
            date={date}
            passengers={passengers}
          />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <aside className="sticky top-20 hidden lg:block lg:w-60 lg:shrink-0">
              <SearchFilters />
            </aside>
            <div className="min-w-0 flex-1">
              <SearchResults
                from={from}
                to={to}
                date={date}
                passengers={passengers}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <p className="text-muted-foreground text-center">
            {t("startSearch")}
          </p>
          <SearchForm />
        </div>
      )}
    </div>
  );
}
