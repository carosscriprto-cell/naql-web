"use client";

import { useTranslations } from "next-intl";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PASSENGER_OPTIONS = ["1", "2", "3", "4", "5"];

export function PassengersSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("searchForm");
  const items = PASSENGER_OPTIONS.map((option) => ({
    value: option,
    label: t("passengersCount", { count: Number(option) }),
  }));

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => onChange(next ?? "1")}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
