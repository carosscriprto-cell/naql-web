"use client";

import { useMemo } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/features/search/components/form-field";
import { ApiError } from "@/lib/api-error";
import { useSignIn } from "../hooks/use-sign-in";
import { buildLoginSchema, type LoginFormValues } from "../schemas";

/** Error UX keys on `ApiError.code` only — never on the message (CLAUDE.md). */
function messageKey(error: Error | null): string | null {
  if (!error) return null;
  if (!(error instanceof ApiError)) return "errors.generic";
  if (error.code === "UNAUTHORIZED") return "errors.invalidCredentials";
  if (error.code === "FORBIDDEN") return "errors.notOperator";
  return "errors.generic";
}

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("operator.login");
  const signIn = useSignIn(next);

  const schema = useMemo(() => buildLoginSchema(t), [t]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const serverError = messageKey(signIn.error);

  return (
    <Card className="w-full max-w-sm">
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-muted-foreground text-xs">{t("subtitle")}</p>
        </div>

        <form
          onSubmit={handleSubmit((values) => signIn.mutate(values))}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            label={t("email")}
            htmlFor="operator-email"
            error={errors.email?.message}
          >
            <Input
              id="operator-email"
              type="email"
              inputMode="email"
              dir="ltr"
              autoComplete="username"
              placeholder={t("emailPlaceholder")}
              aria-invalid={!!errors.email}
              {...register("email")}
            />
          </FormField>

          <FormField
            label={t("password")}
            htmlFor="operator-password"
            error={errors.password?.message}
          >
            <Input
              id="operator-password"
              type="password"
              dir="ltr"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
          </FormField>

          {serverError ? (
            <p role="alert" className="text-destructive text-sm">
              {t(serverError)}
            </p>
          ) : null}

          {/* `|| isSuccess`: the mutation settles the moment the session exists,
              but the redirect is still in flight for another frame or two and
              the form must not invite a second submit in that window. */}
          <Button
            type="submit"
            size="lg"
            disabled={signIn.isPending || signIn.isSuccess}
          >
            {signIn.isPending || signIn.isSuccess ? t("submitting") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
