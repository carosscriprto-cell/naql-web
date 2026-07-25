"use client";

import { useState } from "react";
import { ClipboardCheckIcon, ClipboardIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function PnrCopy({ pnr }: { pnr: string }) {
  const t = useTranslations("confirmation");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pnr);
      setCopied(true);
      toast.success(t("copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <div className="bg-primary/5 flex flex-col items-center gap-2 rounded-3xl p-5">
      <p className="text-muted-foreground text-xs">{t("pnrLabel")}</p>
      <p className="font-mono text-3xl font-bold tracking-[0.25em]">{pnr}</p>
      <Button variant="outline" size="sm" onClick={copy}>
        {copied ? (
          <ClipboardCheckIcon aria-hidden />
        ) : (
          <ClipboardIcon aria-hidden />
        )}
        {t("copy")}
      </Button>
    </div>
  );
}
