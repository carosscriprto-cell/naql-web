import { ArmchairIcon, SearchIcon, TicketCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

const steps = [
  { icon: SearchIcon, key: "search" },
  { icon: ArmchairIcon, key: "seat" },
  { icon: TicketCheckIcon, key: "ticket" },
] as const;

export function HowItWorks() {
  const t = useTranslations("howItWorks");

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 lg:py-24">
      <h2 className="text-center text-2xl font-bold lg:text-3xl">
        {t("title")}
      </h2>
      <ol className="relative mt-10 flex flex-col gap-10 lg:grid lg:grid-cols-3 lg:gap-8">
        {/* dashed connector: vertical along the start edge on mobile, horizontal through the icons on lg */}
        <div
          aria-hidden
          className="border-primary/25 absolute start-8 top-4 bottom-4 border-s-2 border-dashed lg:hidden"
        />
        <div
          aria-hidden
          className="border-primary/25 absolute inset-x-[16%] top-8 hidden border-t-2 border-dashed lg:block"
        />
        {steps.map(({ icon: Icon, key }) => (
          <li
            key={key}
            className="relative flex items-start gap-4 lg:flex-col lg:items-center lg:text-center"
          >
            <span className="bg-background z-10 flex size-16 shrink-0 items-center justify-center rounded-full">
              <span className="bg-primary/10 text-primary flex size-full items-center justify-center rounded-full">
                <Icon className="size-7" aria-hidden />
              </span>
            </span>
            <div className="pt-1.5 lg:pt-0">
              <h3 className="font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="text-muted-foreground mt-1 max-w-xs text-sm">
                {t(`steps.${key}.description`)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
