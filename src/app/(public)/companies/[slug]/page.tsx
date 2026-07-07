import { getTranslations } from "next-intl/server";

import { companies } from "@/mocks/data";

// Placeholder — the real company profile page is built in a later phase.
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("companyPage");
  const company = companies.find((c) => c.slug === slug);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-2xl font-bold">{company?.name ?? t("title")}</h1>
      <p className="text-muted-foreground mt-2">{t("underConstruction")}</p>
    </div>
  );
}
