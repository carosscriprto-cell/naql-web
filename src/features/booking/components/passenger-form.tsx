"use client";

import { useTranslations } from "next-intl";
import type { UseFormRegister } from "react-hook-form";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/features/search/components/form-field";
import type { CheckoutFormValues, Gender } from "../schemas";
import { GenderIcon } from "./gender-icon";

export function PassengerForm({
  index,
  seatNumber,
  gender,
  register,
  nameError,
  phoneError,
  phoneDisabled,
}: {
  index: number;
  seatNumber: string;
  gender: Gender;
  register: UseFormRegister<CheckoutFormValues>;
  nameError?: string;
  phoneError?: string;
  phoneDisabled: boolean;
}) {
  const t = useTranslations("checkout");
  const nameId = `passenger-${index}-name`;
  const phoneId = `passenger-${index}-phone`;

  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">{t("seat", { number: seatNumber })}</p>
          <span className="bg-muted flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
            <GenderIcon gender={gender} className="size-3.5" />
            {t(gender)}
          </span>
        </div>
        <p className="text-muted-foreground -mt-2 text-xs">{t("genderHint")}</p>

        <FormField label={t("fullName")} htmlFor={nameId} error={nameError}>
          <Input
            id={nameId}
            placeholder={t("fullNamePlaceholder")}
            aria-invalid={!!nameError}
            {...register(`passengers.${index}.fullName`)}
          />
        </FormField>

        <FormField label={t("phone")} htmlFor={phoneId} error={phoneError}>
          <Input
            id={phoneId}
            type="tel"
            inputMode="tel"
            dir="ltr"
            placeholder={t("phonePlaceholder")}
            disabled={phoneDisabled}
            aria-invalid={!!phoneError}
            {...register(`passengers.${index}.phone`)}
          />
        </FormField>
      </CardContent>
    </Card>
  );
}
