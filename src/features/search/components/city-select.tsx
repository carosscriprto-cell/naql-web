"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCities } from "../hooks/use-cities";

type CitySelectProps = {
  id: string;
  value: string;
  onChange: (slug: string) => void;
  placeholder: string;
  /** City slug to hide from the options (e.g. the already-selected origin). */
  excludeSlug?: string;
  invalid?: boolean;
};

export function CitySelect({
  id,
  value,
  onChange,
  placeholder,
  excludeSlug,
  invalid,
}: CitySelectProps) {
  const { data: cities, isPending } = useCities();

  if (isPending) {
    return <Skeleton className="h-9 w-full rounded-3xl" />;
  }

  const items = (cities ?? [])
    .filter((city) => city.slug !== excludeSlug)
    .map((city) => ({ value: city.slug, label: city.nameAr }));

  return (
    <Select
      items={items}
      value={value === "" ? null : value}
      onValueChange={(slug) => onChange(slug ?? "")}
    >
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid}>
        <SelectValue placeholder={placeholder} />
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
