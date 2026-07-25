import { MarsIcon, VenusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Gender } from "../schemas";

// Single source of truth for the gender icon + color, so the map, selection
// bar, checkout badges and ticket table stay visually identical.
export function GenderIcon({
  gender,
  className,
}: {
  gender: Gender;
  className?: string;
}) {
  const Icon = gender === "male" ? MarsIcon : VenusIcon;
  return (
    <Icon
      className={cn(
        gender === "male" ? "text-sky-600" : "text-pink-600",
        className,
      )}
      aria-hidden
    />
  );
}
