import { useTranslations } from "next-intl";

const statKeys = ["companies", "dailyTrips", "cities", "bookedSeats"] as const;

export function StatsStrip() {
  const t = useTranslations("stats");

  return (
    <section className="bg-muted/40 border-y">
      <dl className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-8 px-4 py-10 lg:grid-cols-4 lg:py-14">
        {statKeys.map((key) => (
          <div
            key={key}
            className="flex flex-col items-center gap-1 text-center"
          >
            <dd
              className="text-primary order-1 text-3xl font-bold lg:text-4xl"
              dir="ltr"
            >
              {t(`${key}.value`)}
            </dd>
            <dt className="text-muted-foreground order-2 text-sm">
              {t(`${key}.label`)}
            </dt>
          </div>
        ))}
      </dl>
    </section>
  );
}
