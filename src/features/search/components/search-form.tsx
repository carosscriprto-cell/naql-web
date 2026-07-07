"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { ArrowRightLeftIcon, SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CitySelect } from "./city-select";
import { DatePicker } from "./date-picker";
import { FormField } from "./form-field";
import { PassengersSelect } from "./passengers-select";
import {
  buildSearchFormSchema,
  type SearchFormValues,
} from "./search-form-schema";

export function SearchForm({
  initialValues,
}: {
  initialValues?: Partial<SearchFormValues>;
} = {}) {
  const t = useTranslations("searchForm");
  const router = useRouter();
  const schema = useMemo(() => buildSearchFormSchema(t), [t]);

  const {
    control,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<SearchFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { from: "", to: "", passengers: "1", ...initialValues },
  });
  const fromValue = useWatch({ control, name: "from" });

  function swapCities() {
    const { from, to } = getValues();
    setValue("from", to);
    setValue("to", from);
  }

  function onSubmit(values: SearchFormValues) {
    const params = new URLSearchParams({
      from: values.from,
      to: values.to,
      date: format(values.date, "yyyy-MM-dd"),
      passengers: values.passengers,
    });
    router.push(`/search?${params.toString()}`);
  }

  return (
    <Card className="py-0">
      <CardContent className="p-4 lg:p-6">
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr_1.3fr_1fr_auto] lg:items-start"
        >
          <Controller
            control={control}
            name="from"
            render={({ field }) => (
              <FormField
                label={t("from")}
                htmlFor="from-city"
                error={errors.from?.message}
              >
                <CitySelect
                  id="from-city"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("fromPlaceholder")}
                  invalid={!!errors.from}
                />
              </FormField>
            )}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={swapCities}
            aria-label={t("swap")}
            className="justify-self-center lg:mt-6.5"
          >
            <ArrowRightLeftIcon className="rotate-90 lg:rotate-0" />
          </Button>

          <Controller
            control={control}
            name="to"
            render={({ field }) => (
              <FormField
                label={t("to")}
                htmlFor="to-city"
                error={errors.to?.message}
              >
                <CitySelect
                  id="to-city"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("toPlaceholder")}
                  excludeSlug={fromValue}
                  invalid={!!errors.to}
                />
              </FormField>
            )}
          />

          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <FormField
                label={t("date")}
                htmlFor="travel-date"
                error={errors.date?.message}
              >
                <DatePicker
                  id="travel-date"
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t("datePlaceholder")}
                  invalid={!!errors.date}
                />
              </FormField>
            )}
          />

          <Controller
            control={control}
            name="passengers"
            render={({ field }) => (
              <FormField label={t("passengers")} htmlFor="passengers">
                <PassengersSelect
                  id="passengers"
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormField>
            )}
          />

          <Button type="submit" className="lg:mt-6.5">
            <SearchIcon aria-hidden />
            {t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
