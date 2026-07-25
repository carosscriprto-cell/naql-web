"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClockIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { releaseLock } from "../api";
import { useBookingStore } from "../store";

const URGENT_MS = 120_000;

export function LockCountdown() {
  const t = useTranslations("checkout");
  const router = useRouter();
  const lockExpiresAt = useBookingStore((s) => s.lockExpiresAt);
  const expiresMs = lockExpiresAt ? new Date(lockExpiresAt).getTime() : 0;
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, expiresMs - Date.now()),
  );

  // Recompute from the wall clock every second — never a setTimeout duration,
  // so a backgrounded tab can't drift (CLAUDE.md).
  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining(Math.max(0, expiresMs - Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [expiresMs]);

  const expired = remaining <= 0;
  const totalSeconds = Math.floor(remaining / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  const urgent = remaining > 0 && remaining < URGENT_MS;

  function handleExpire() {
    const { lockId, tripId, clearLock } = useBookingStore.getState();
    if (lockId) void releaseLock(lockId).catch(() => {});
    clearLock();
    router.push(tripId ? `/trips/${tripId}` : "/");
  }

  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-40 flex items-center justify-center gap-2 border-b py-2.5 text-sm font-medium",
          urgent
            ? "bg-destructive/10 text-destructive"
            : "bg-background/95 text-foreground backdrop-blur",
        )}
      >
        <AlarmClockIcon className="size-4" aria-hidden />
        <span>{t("timeLeft")}</span>
        <span className="font-mono tabular-nums">
          {mm}:{ss}
        </span>
      </div>

      <Dialog open={expired}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("expired.title")}</DialogTitle>
            <DialogDescription>{t("expired.description")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={handleExpire}>{t("expired.action")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
