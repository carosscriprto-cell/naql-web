import { z } from "zod";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const envelope = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
  }),
]);

export async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError("NETWORK_ERROR", error.message);
  const parsed = envelope.parse(data);
  if (!parsed.ok) {
    const e = parsed.error;
    throw new ApiError(e.code, e.message, e.details);
  }
  return schema.parse(parsed.data);
}