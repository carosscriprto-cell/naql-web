import { z } from "zod";
import { ApiError } from "./api-error";

const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      // .nullish(), not .optional(): the RPCs emit an explicit `details: null`
      // and MSW omits the key — both mean "no details" (BACKEND_V1 §0
      // `details` rule). .optional() rejects null and turns every real backend
      // domain error into a ZodError instead of an ApiError.
      details: z.record(z.string(), z.unknown()).nullish(),
    }),
  }),
]);

/** يفكّ مغلّف BACKEND_V1 §0 — مشترك بين MSW و Supabase RPC */
export function unwrap<T>(raw: unknown, schema: z.ZodType<T>): T {
  const parsed = envelopeSchema.parse(raw);
  if (!parsed.ok) {
    throw new ApiError(parsed.error.code, parsed.error.message, parsed.error.details);
  }
  return schema.parse(parsed.data);
}