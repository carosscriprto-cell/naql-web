import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoginForm } from "@/features/auth/components/login-form";
import { safeOperatorPath } from "@/features/auth/schemas";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("operator.login");
  return { title: t("title") };
}

// OPR-0. The only page under /operator a signed-out visitor may see; an
// operator who lands here is redirected away by `proxy.ts` before it renders.
// `?next=` carries the path the guard interrupted, sanitised before use.
export default async function OperatorLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const target = safeOperatorPath(Array.isArray(next) ? next[0] : next);

  return <LoginForm next={target} />;
}
