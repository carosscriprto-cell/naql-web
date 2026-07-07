import { z } from "zod";

type Translator = (key: string) => string;

// Built per-render with the active translator so validation messages come from ar.json.
export function buildSearchFormSchema(t: Translator) {
  return z
    .object({
      from: z.string().min(1, t("errors.fromRequired")),
      to: z.string().min(1, t("errors.toRequired")),
      date: z.date({ error: t("errors.dateRequired") }),
      passengers: z.string().min(1),
    })
    .refine((values) => values.from !== values.to, {
      message: t("errors.sameCity"),
      path: ["to"],
    });
}

export type SearchFormValues = z.infer<
  ReturnType<typeof buildSearchFormSchema>
>;
