import Link from "next/link";
import { useTranslations } from "next-intl";
import { BusFrontIcon, MailIcon, MapPinIcon, PhoneIcon } from "lucide-react";

import { navLinks } from "@/components/shared/nav-links";

export function Footer() {
  const t = useTranslations();

  return (
    <footer className="bg-muted/40 border-t">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-3">
          <p className="text-primary flex items-center gap-2 text-lg font-bold">
            <BusFrontIcon className="size-5" aria-hidden />
            {t("brand.name")}
          </p>
          <p className="text-muted-foreground max-w-xs text-sm leading-6">
            {t("footer.about")}
          </p>
        </div>

        <nav aria-label={t("footer.quickLinks")}>
          <h3 className="mb-3 text-sm font-semibold">
            {t("footer.quickLinks")}
          </h3>
          <ul className="text-muted-foreground space-y-2 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="hover:text-foreground transition-colors"
                >
                  {t(`nav.${link.labelKey}`)}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/auth/login"
                className="hover:text-foreground transition-colors"
              >
                {t("nav.login")}
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h3 className="mb-3 text-sm font-semibold">{t("footer.contact")}</h3>
          <ul className="text-muted-foreground space-y-2 text-sm">
            <li className="flex items-center gap-2">
              <PhoneIcon className="size-4" aria-hidden />
              <span dir="ltr">{t("footer.phone")}</span>
            </li>
            <li className="flex items-center gap-2">
              <MailIcon className="size-4" aria-hidden />
              <span dir="ltr">{t("footer.email")}</span>
            </li>
            <li className="flex items-center gap-2">
              <MapPinIcon className="size-4" aria-hidden />
              {t("footer.address")}
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t">
        <p className="text-muted-foreground mx-auto w-full max-w-6xl px-4 py-4 text-center text-sm">
          {t("footer.copyright", { year: new Date().getFullYear() })}
        </p>
      </div>
    </footer>
  );
}
