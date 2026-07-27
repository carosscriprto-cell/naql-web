import { describe, it, expect } from "vitest";
import { publicClient } from "./helpers";

// Regression guard for the §0 `details` rule.
//
// The RPCs emit `jsonb_build_object(..., 'details', null)` on every error path
// that carries no details, because jsonb_build_object cannot omit a key
// conditionally. MSW's fail() passes `details: undefined`, which JSON.stringify
// drops — so the key is ABSENT there and PRESENT-BUT-NULL here. MSW structurally
// could not surface this difference, and it went unnoticed until the first real
// RPC call: src/lib/envelope.ts used .optional(), which rejects null, so every
// domain error from the real backend threw a ZodError instead of an ApiError —
// silently breaking all code-driven error UX at once.
//
// The frontend parser now uses .nullish() and accepts both shapes (asserted
// directly in tests/unit/envelope.test.ts). This file pins the backend half:
// if an RPC ever starts omitting the key, or a new one forgets `details`
// entirely, that is a contract change and must be a deliberate one.

const MISSING_TRIP = "00000000-0000-4000-8000-0000000fffff";

type ErrorEnvelope = {
  ok: false;
  error: { code: string; message: string; details: unknown };
};

// publicClient() is the anon-key client with no session — get_trip / get_seat_map
// need no auth.uid(), and anonClient() spends a rate-limited sign-in for nothing.
async function callRaw(
  fn: "get_trip" | "get_seat_map",
): Promise<ErrorEnvelope> {
  const { data, error } = await publicClient().rpc(fn, {
    p_trip_id: MISSING_TRIP,
  });
  expect(error, `${fn} transport error: ${error?.message}`).toBeNull();
  const env = data as ErrorEnvelope;
  expect(env.ok, `${fn} should have returned a NOT_FOUND envelope`).toBe(false);
  return env;
}

describe("§0 envelope — `details` on error paths", () => {
  for (const fn of ["get_trip", "get_seat_map"] as const) {
    it(`${fn} returns details as an explicit null, not an absent key`, async () => {
      const env = await callRaw(fn);

      expect(env.error.code).toBe("NOT_FOUND");
      expect(typeof env.error.message).toBe("string");

      // Both halves matter: the key is present, and its value is null.
      // `toBeNull()` alone would also pass for an absent key.
      expect(Object.keys(env.error)).toContain("details");
      expect(env.error.details).toBeNull();
    });
  }
});
