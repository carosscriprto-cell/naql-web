"use client";

import { format } from "date-fns";
import { ar } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";

import { Card, CardContent } from "@/components/ui/card";
import type { Booking } from "../schemas";
import { GenderIcon } from "./gender-icon";
import { PnrCopy } from "./pnr-copy";
import { TicketStatusHeader } from "./ticket-status-header";

// A cancelled ticket is read-only: no cancel action is offered here, and the
// frontend never calls cancel_booking from this screen (Task E4 owns that flow).
export function BookingTicket({ booking }: { booking: Booking }) {
  const t = useTranslations("confirmation");
  const { trip, passengers } = booking;
  const departure = new Date(trip.departureAt);
  const cancelled = booking.status === "cancelled";

  return (
    <div className="flex flex-col gap-4">
      <TicketStatusHeader status={booking.status} />

      <PnrCopy pnr={booking.pnr} />

      <Card>
        <CardContent className="flex justify-center">
          {/* The QR is worthless at the gate once cancelled — showing it invites
              a passenger to travel on a dead ticket. */}
          {cancelled ? (
            <p className="text-muted-foreground py-12 text-center text-sm">
              {t("qrVoid")}
            </p>
          ) : (
            <QRCodeSVG value={booking.qrPayload} size={160} title={t("qrAlt")} />
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-col gap-1">
          <p className="font-medium">
            {t("route", {
              from: trip.fromCity.nameAr,
              to: trip.toCity.nameAr,
            })}
          </p>
          <p className="text-muted-foreground text-sm">
            {format(departure, "EEEE d MMMM · h:mm a", { locale: ar })}
          </p>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-semibold">{t("passengersTitle")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-xs">
                <tr>
                  <th className="py-1 text-start font-medium">
                    {t("table.seat")}
                  </th>
                  <th className="py-1 text-start font-medium">
                    {t("table.name")}
                  </th>
                  <th className="py-1 text-start font-medium">
                    {t("table.gender")}
                  </th>
                  <th className="py-1 text-start font-medium">
                    {t("table.phone")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {passengers.map((passenger) => (
                  <tr key={passenger.seatNumber} className="border-t">
                    <td className="py-2">{passenger.seatNumber}</td>
                    <td className="py-2">{passenger.fullName}</td>
                    <td className="py-2">
                      <span className="flex items-center gap-1">
                        <GenderIcon
                          gender={passenger.gender}
                          className="size-3.5"
                        />
                        {t(passenger.gender)}
                      </span>
                    </td>
                    <td className="py-2" dir="ltr">
                      {passenger.phone}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="font-semibold">{t("total")}</span>
        <span className="text-primary text-lg font-bold">
          {t("price", { price: booking.totalPrice })}
        </span>
      </div>

      <div className="bg-muted text-muted-foreground rounded-3xl p-4 text-center text-sm">
        {t("notice")}
      </div>
    </div>
  );
}
