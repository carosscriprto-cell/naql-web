import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "sonner";
import "./globals.css";
import { cn } from "@/lib/utils";
import { MockProvider } from "@/providers/mock-provider";
import { QueryProvider } from "@/providers/query-provider";

const ibmPlexSansArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "النقل الذكي",
  description: "منصة حجز رحلات النقل بين المدن السورية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={cn("h-full font-sans antialiased", ibmPlexSansArabic.variable)}
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <MockProvider>
            <QueryProvider>{children}</QueryProvider>
          </MockProvider>
          <Toaster position="top-center" dir="rtl" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
