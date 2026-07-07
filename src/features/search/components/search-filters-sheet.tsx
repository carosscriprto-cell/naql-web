"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTripFilters } from "../hooks/use-trip-filters";
import { SearchFilters } from "./search-filters";

// Mobile-only entry point to the filters panel (desktop shows a sidebar).
export function SearchFiltersSheet() {
  const t = useTranslations("filters");
  const { activeCount } = useTripFilters();

  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="lg:hidden" />}
      >
        <SlidersHorizontalIcon aria-hidden />
        {t("trigger")}
        {activeCount > 0 && <Badge className="ms-1">{activeCount}</Badge>}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="bg-background max-h-[80vh] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="px-6 pb-8">
          <SearchFilters />
        </div>
      </SheetContent>
    </Sheet>
  );
}
