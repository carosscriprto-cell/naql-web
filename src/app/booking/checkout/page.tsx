"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import { ApiError } from "@/lib/api-error";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { createBooking, releaseLock } from "@/features/booking/api";
import { LockCountdown } from "@/features/booking/components/lock-countdown";
import { OrderSummary } from "@/features/booking/components/order-summary";
import { PassengerForm } from "@/features/booking/components/passenger-form";
import {
  buildCheckoutSchema,
  type CheckoutFormValues,
} from "@/features/booking/schemas";
import { useBookingStore } from "@/features/booking/store";
import { useTrip } from "@/features/search/hooks/use-trip";

export default function CheckoutPage() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const lockId = useBookingStore((s) => s.lockId);
  const tripId = useBookingStore((s) => s.tripId);
  const selectedSeats = useBookingStore((s) => s.selectedSeats);
  const { data: trip } = useTrip(tripId ?? "");

  // Guard: reaching checkout without a live lock → home (PAS-6).
  useEffect(() => {
    if (!lockId) router.replace("/");
  }, [lockId, router]);

  // Best-effort release on leave without a completed booking (PAS-5 AC-3).
  // The mount-time guard skips React StrictMode's synthetic dev remount.
  useEffect(() => {
    const mountedAt = Date.now();
    const release = () => {
      const { lockId: id, clearLock } = useBookingStore.getState();
      if (!id) return;
      void releaseLock(id).catch(() => {});
      clearLock();
    };
    window.addEventListener("beforeunload", release);
    return () => {
      window.removeEventListener("beforeunload", release);
      if (Date.now() - mountedAt > 400) release();
    };
  }, []);

  const schema = useMemo(() => buildCheckoutSchema(t), [t]);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      passengers: selectedSeats.map((s) => ({
        seatNumber: s.seatNumber,
        gender: s.gender,
        fullName: "",
        phone: "",
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: "passengers" });

  // "Same phone for all" mirrors the first passenger's number to the rest.
  const [samePhone, setSamePhone] = useState(false);
  const firstPhone = useWatch({ control, name: "passengers.0.phone" });
  useEffect(() => {
    if (!samePhone) return;
    getValues("passengers").forEach((_, i) => {
      if (i > 0) {
        setValue(`passengers.${i}.phone`, firstPhone ?? "", {
          shouldValidate: true,
        });
      }
    });
  }, [samePhone, firstPhone, getValues, setValue]);

  const bookingMutation = useMutation({
    mutationFn: (values: CheckoutFormValues) => {
      const { lockId: id, idempotencyKey } = useBookingStore.getState();
      return createBooking({
        lockId: id ?? "",
        idempotencyKey: idempotencyKey ?? "",
        paymentMethod: "cash",
        passengers: values.passengers,
      });
    },
    onSuccess: (booking) => {
      useBookingStore.getState().setBooking(booking);
      useBookingStore.getState().clearLock();
      router.replace("/booking/confirmation");
    },
    onError: (error) => {
      const code = error instanceof ApiError ? error.code : "";
      if (code === "LOCK_EXPIRED") {
        // Same flow as countdown-zero: force the expiry dialog (AC-6).
        useBookingStore.getState().expireLock();
      } else if (
        code === "BOOKING_LIMIT_REACHED" ||
        code === "VALIDATION_ERROR"
      ) {
        toast.error(error.message);
      } else {
        toast.error(t("genericError"));
      }
    },
  });

  if (!lockId) return null;
  if (!trip) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8">
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    );
  }

  const onSubmit = (values: CheckoutFormValues) => bookingMutation.mutate(values);

  return (
    <div>
      <LockCountdown />
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6"
      >
        <h1 className="text-lg font-semibold">{t("title")}</h1>

        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">{t("passengersTitle")}</h2>
          {fields.map((field, index) => (
            <PassengerForm
              key={field.id}
              index={index}
              seatNumber={selectedSeats[index]?.seatNumber ?? ""}
              gender={selectedSeats[index]?.gender ?? "male"}
              register={register}
              nameError={errors.passengers?.[index]?.fullName?.message}
              phoneError={errors.passengers?.[index]?.phone?.message}
              phoneDisabled={samePhone && index > 0}
            />
          ))}
          {selectedSeats.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={samePhone}
                onCheckedChange={(value) => setSamePhone(value === true)}
              />
              {t("samePhone")}
            </label>
          )}
        </section>

        <Card size="sm">
          <CardContent className="flex flex-col gap-2">
            <h2 className="font-semibold">{t("payment.title")}</h2>
            <RadioGroup defaultValue="office">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="office" disabled />
                {t("payment.office")}
              </label>
            </RadioGroup>
            <p className="text-muted-foreground text-xs">
              {t("payment.explainer")}
            </p>
          </CardContent>
        </Card>

        <OrderSummary
          trip={trip}
          selectedSeats={selectedSeats}
          isPending={bookingMutation.isPending}
        />
      </form>
    </div>
  );
}
