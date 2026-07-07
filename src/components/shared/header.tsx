import Link from "next/link";
import { useTranslations } from "next-intl";
import { BusFrontIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { MobileNav } from "@/components/shared/mobile-nav";
import { navLinks } from "@/components/shared/nav-links";

export function Header() {
  const t = useTranslations();

  return (
    <header className="bg-background/80 supports-backdrop-filter:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Link
          href="/"
          className="text-primary flex items-center gap-2 text-lg font-bold"
        >
          <BusFrontIcon className="size-6" aria-hidden />
          {t("brand.name")}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground rounded-md px-3 py-2 text-sm font-medium transition-colors"
            >
              {t(`nav.${link.labelKey}`)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            className="hidden md:inline-flex"
            render={<Link href="/auth/login" />}
          >
            {t("nav.login")}
          </Button>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
