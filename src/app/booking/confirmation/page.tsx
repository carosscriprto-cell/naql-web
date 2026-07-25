"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { BookingTicket } from "@/features/booking/components/booking-ticket";
import { useBookingStore } from "@/features/booking/store";

export default function ConfirmationPage() {
  const t = useTranslations("confirmation");
  const router = useRouter();
  const booking = useBookingStore((s) => s.booking);

  // Guard: no booking in store → home.
  useEffect(() => {
    if (!booking) router.replace("/");
  }, [booking, router]);

  if (!booking) return null;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <BookingTicket booking={booking} />
      <Button
        variant="outline"
        className="mt-6 w-full"
        render={<Link href="/" />}
      >
        {t("home")}
      </Button>
    </div>
  );
}
