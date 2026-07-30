"use client";

import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useSignOut } from "../hooks/use-sign-out";

export function SignOutButton() {
  const t = useTranslations("operator");
  const signOut = useSignOut();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
    >
      <LogOut aria-hidden />
      {t("signOut")}
    </Button>
  );
}
