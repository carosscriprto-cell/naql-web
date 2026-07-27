import { describe, it, expect } from "vitest";
import { z } from "zod";

import { ApiError } from "@/lib/api-error";
import { unwrap } from "@/lib/envelope";

// The frontend half of the §0 `details` rule (backend half: tests/db/envelope.test.ts).
//
// `details` may be ABSENT (MSW drops the undefined key) or explicitly `null`
// (the Postgres RPCs cannot conditionally omit it). Both mean "no details".
// A parser that accepts only one of them turns every real domain error into a
// ZodError, and ZodError carries no `.code` — so error UX, which keys on
// ApiError.code and nothing else, degrades to the generic toast for
// SEAT_ALREADY_LOCKED, LOCK_EXPIRED, BOOKING_LIMIT_REACHED and the rest at once.
//
// Hence the assertions below check the thrown TYPE, not just that it throws.

const schema = z.object({ id: z.string() });

function catchThrown(raw: unknown): unknown {
  try {
    unwrap(raw, schema);
  } catch (e) {
    return e;
  }
  throw new Error("expected unwrap() to throw");
}

const errorEnvelopes = {
  "details: null (real backend)": {
    ok: false,
    error: { code: "NOT_FOUND", message: "Trip not found", details: null },
  },
  "details key absent (MSW)": {
    ok: false,
    error: { code: "NOT_FOUND", message: "الرحلة غير موجودة" },
  },
} as const;

describe("unwrap() — error envelopes", () => {
  for (const [label, raw] of Object.entries(errorEnvelopes)) {
    it(`throws ApiError, never ZodError, for ${label}`, () => {
      const thrown = catchThrown(raw);

      expect(thrown).toBeInstanceOf(ApiError);
      expect(thrown).not.toBeInstanceOf(z.ZodError);
      expect((thrown as ApiError).code).toBe("NOT_FOUND");
      expect((thrown as ApiError).message).toBe(raw.error.message);
    });
  }

  it("preserves details when the backend does send them", () => {
    const thrown = catchThrown({
      ok: false,
      error: {
        code: "SEAT_ALREADY_LOCKED",
        message: "تم حجز بعض المقاعد للتو",
        details: { seats: ["12", "13"] },
      },
    });

    expect(thrown).toBeInstanceOf(ApiError);
    // seat-selection.tsx reads exactly this to drop the conflicting seats.
    expect((thrown as ApiError).details?.seats).toEqual(["12", "13"]);
  });
});

describe("unwrap() — success envelopes", () => {
  it("returns the parsed data", () => {
    expect(unwrap({ ok: true, data: { id: "t1" } }, schema)).toEqual({
      id: "t1",
    });
  });

  it("still throws ZodError when the DATA shape is wrong — that is a real mismatch", () => {
    const thrown = catchThrown({ ok: true, data: { id: 42 } });
    expect(thrown).toBeInstanceOf(z.ZodError);
    expect(thrown).not.toBeInstanceOf(ApiError);
  });
});
