import { useTranslations } from "next-intl";

// Placeholder — the operator portal is built in Phase D.
export default function OperatorPage() {
  const t = useTranslations("operatorPage");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-muted-foreground mt-2">{t("underConstruction")}</p>
    </div>
  );
}
