"use client";

import { useState } from "react";
import { format, startOfToday } from "date-fns";
import { ar } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DatePickerProps = {
  id: string;
  value?: Date;
  onChange: (date?: Date) => void;
  placeholder: string;
  invalid?: boolean;
};

export function DatePicker({
  id,
  value,
  onChange,
  placeholder,
  invalid,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
            )}
          />
        }
      >
        {value
          ? format(value, "EEEE d MMMM yyyy", { locale: ar })
          : placeholder}
        <CalendarIcon className="text-muted-foreground size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={ar}
          selected={value}
          disabled={{ before: startOfToday() }}
          onSelect={(date) => {
            onChange(date);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
