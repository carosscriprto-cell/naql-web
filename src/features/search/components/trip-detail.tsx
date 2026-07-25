"use client";

import Link from "next/link";
import { SearchXIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTrip } from "../hooks/use-trip";
import { TripDetailView } from "./trip-detail-view";

export function TripDetail({ id }: { id: string }) {
  const t = useTranslations("tripDetail");
  const { data: trip, isPending, isError, error } = useTrip(id);

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6">
        <Skeleton className="h-40 w-full rounded-4xl" />
        <Skeleton className="h-20 w-full rounded-4xl" />
        <Skeleton className="h-20 w-full rounded-4xl" />
        <Skeleton className="h-28 w-full rounded-4xl" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.code === "NOT_FOUND";
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <SearchXIcon className="text-muted-foreground size-8" aria-hidden />
            <p className="text-lg font-semibold">
              {notFound ? t("notFound.title") : t("error")}
            </p>
            {notFound && (
              <p className="text-muted-foreground text-sm">
                {t("notFound.description")}
              </p>
            )}
            <Button variant="outline" className="mt-2" render={<Link href="/" />}>
              {t("notFound.back")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <TripDetailView trip={trip} />;
}
