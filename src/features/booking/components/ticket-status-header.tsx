"use client";

import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { BookingStatus } from "../schemas";

/**
 * Ticket header. A cancelled ticket must never read as a valid one: it swaps the
 * success mark for a destructive one, carries an explicit ملغي badge, and says
 * the seats went back on sale (docs/BACKEND_V1.md §4).
 */
export function TicketStatusHeader({ status }: { status: BookingStatus }) {
  const t = useTranslations("confirmation");
  const cancelled = status === "cancelled";

  return (
    <div className="flex flex-col items-center gap-2 text-center">
      {cancelled ? (
        <XCircleIcon className="text-destructive size-12" aria-hidden />
      ) : (
        <CheckCircle2Icon className="text-primary size-12" aria-hidden />
      )}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <h1 className="text-xl font-bold">
          {cancelled ? t("cancelledTitle") : t("title")}
        </h1>
        {cancelled ? (
          <Badge variant="destructive">{t("cancelledBadge")}</Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        {cancelled ? t("cancelledSubtitle") : t("subtitle")}
      </p>
    </div>
  );
}
