# Claude Code — Task Prompts (Frontend: naql-web)

**Status:** Tasks 1–9 done. Task 9.5 (green-up + envelope migration) is the next session.
**Backend:** Supabase (`docs/BACKEND_V1.md`, `docs/BACKEND_EXECUTION_PLAN.md`). Backend repo `naql-db` not created yet — B0 is the parallel critical path.
**Key architectural decision (2026-07-25):** MSW mirrors the **BACKEND_V1 §0 envelope** from day one — `{ ok:true, data }` / `{ ok:false, error:{ code, message, details? } }`, always HTTP 200. The frontend never reads HTTP status codes; all error UX keys on `ApiError.code`. Phase E therefore becomes a one-line swap inside each `api.ts` function.
**Shared plumbing (already built):** `src/lib/api-error.ts` (`ApiError`) + `src/lib/envelope.ts` (`unwrap(raw, schema)`). Both MSW-era and Supabase-era code paths use them unchanged.
**Deleted as premature:** `src/lib/supabase.ts`, `src/lib/rpc.ts` — they return in Task E1, after backend M2.
**Scope:** no passenger OTP in v1 — guest checkout on an anonymous session; tickets via device-local list + PNR lookup. Gender (ذكر/أنثى) per passenger, displayed on locked/booked seats.

## How to use

- One task per session. Review the diff, run the task's verification, commit before the next.
- Never stack two tasks in one prompt. If output is wrong: revert, tighten, rerun — don't patch in-session.

---

## 0) CLAUDE.md — apply before Task 10

Append to the existing CLAUDE.md (paste manually, no session needed):

```md
## API convention (MSW now, Supabase later)
- Every MSW handler returns the BACKEND_V1 §0 envelope with HTTP 200:
  ok(data) | fail(code, message, details?). No 4xx/5xx for domain errors — they are DATA, not transport failures.
- Every features/*/api.ts function unwraps via lib/envelope.ts `unwrap()` and throws ApiError.
- Error UX keys on ApiError.code ONLY. Never on message text, never on HTTP status.
- Codes come from the fixed list in docs/BACKEND_V1.md §0.

## Booking flow rules (Phase B)
- Booking client state lives in ONE zustand store: src/features/booking/store.ts
  (selectedSeats: {seatNumber, gender}[], lockId, lockExpiresAt, idempotencyKey, booking). Not in URL, not in context.
- Gender: enum "male" | "female". Locked/booked seats render a gender indicator.
  Selected seats default to "male", toggleable in the selection bar. Gender is sent with the lock request.
- Seat map: refetchInterval 15s, staleTime 5s, key queryKeys.trips.seats(id).
- MSW simulates failure paths behind deterministic triggers (seat "13" always conflicts;
  phone ending "00" hits the booking limit) so every error path is demoable.
- Countdown derives from lockExpiresAt (server time), never from a local setTimeout duration.
- Toaster (sonner) is mounted once in the root layout; features call toast() directly.
- Seat map, checkout, confirmation are client components; everything else stays a Server Component.

## Backend target (Phase E)
- api.ts signatures never change. Phase E swaps only the transport line:
  axios+unwrap → supabase.rpc()+unwrap. RPC args are snake_case (p_trip_id, p_seats) — the
  mapping lives in api.ts. Supabase types (types/database.ts) never leak into components.
```

---

## Task 9.5 — Green-up + envelope migration

```
Repair task. No new features, no new routes, no new components.

GOAL: green build + migrate Tasks 1–9 to the BACKEND_V1 §0 envelope convention.

SCOPE — these files only:
  src/lib/api-client.ts
  src/mocks/handlers.ts
  src/features/search/api.ts
  src/features/search/schemas.ts

1. api-client.ts: baseURL = "/api" (relative). Remove every NEXT_PUBLIC_API_URL reference. Keep interceptors as-is.
2. handlers.ts: remove the API_URL-derived base; handlers match relative paths ("/api/cities", "/api/trips/search").
3. Add a local helper at the top of handlers.ts and route BOTH existing handlers through it:
     ok(data)                       → HttpResponse.json({ ok: true, data })
     fail(code, message, details?)  → HttpResponse.json({ ok: false, error: {...} })   // ALWAYS status 200
   - GET /api/cities        → ok(City[])
   - GET /api/trips/search  → ok({ items: Trip[], meta: {...} })   // keep current meta fields, just nest them under data
4. search/api.ts: both functions go through unwrap(response.data, schema) from @/lib/envelope.
   Delete the direct .parse(response.data) calls. Signatures and return types must NOT change —
   hooks and components stay untouched.
5. search/schemas.ts: adjust only what the new nesting requires (the search response schema now
   describes the INNER data payload, not the envelope). Do not rename exported schemas.

NOT in this task: trip detail, booking, supabase, any UI change, any new dependency.

Verify: npx tsc --noEmit && npm run lint && npm run build, then npm run dev → home + /search render
results and filters exactly as before. Report any behavior difference.
```

---

## Task 10 — Trip details page (PAS-3)

```
Build /trips/[id] per docs/USER_STORIES.md PAS-3 (AC-1, AC-2). Read CLAUDE.md first.

SCOPE — these files only:
  src/mocks/data.ts, src/mocks/handlers.ts
  src/features/search/{schemas.ts, api.ts, hooks/use-trip.ts}
  src/app/(public)/trips/[id]/page.tsx (+ trip-detail components as needed)

1. MSW: GET /api/trips/:id → ok(tripDetail) where tripDetail = search item shape + cancellationPolicy: string.
   Unknown id → fail("NOT_FOUND", "الرحلة غير موجودة"). Use the ok/fail helpers from Task 9.5.
   Reuse existing mock trips; ADD two fixtures with stable ids: one departed (departureAt in the past),
   one full (availableSeats: 0).
2. zod tripDetailSchema in search/schemas.ts, reusing existing company/city sub-schemas — no duplication.
   getTrip(id) in search/api.ts via unwrap().
3. use-trip.ts: queryKeys.trips.detail(id), no refetchInterval.
4. Page sections: header (from→to, dep/arr times, duration, date via date-fns ar locale) · company card
   (logo, name, rating) · price per seat + busType badge · callout "الإلغاء مجاني حتى ساعتين قبل الانطلاق"
   · placeholder section "اختيار المقاعد" (seat map = Task 11) · sticky bottom CTA "اختيار المقاعد".
5. Disabled CTA states (AC-2): departureAt < now → "انطلقت الرحلة"; availableSeats === 0 → "اكتملت المقاعد".
   Reason visible as text, not just a disabled button.
6. Loading skeleton + NOT_FOUND state. All strings from src/messages/ar.json.

NOT in this task: seat map, lock API, zustand store, checkout.

Verify: npx tsc --noEmit && npm run build. Open the 3 fixtures (normal / departed / full) at 375px,
confirm each CTA state.
```

---

## Task 11 — Seat map: rendering + selection + gender (PAS-4 AC-1..5)

```
Build the interactive seat map inside /trips/[id] per docs/BACKEND_V1.md §3 and USER_STORIES.md PAS-4.

SCOPE:
  src/mocks/{data.ts, handlers.ts}
  src/features/booking/{schemas.ts, api.ts, store.ts, hooks/use-seat-map.ts, components/*}
  src/app/(public)/trips/[id]/page.tsx (mount the map)

1. MSW: GET /api/trips/:id/seats → ok({ layout: {rows:12, cols:4, aisleAfterCol:2}, seats: [...] }).
   Generate the 12×4 map in src/mocks/data.ts: mix of available/locked/booked; every locked/booked seat
   carries gender "male"|"female" (mix both); available seats carry NO gender field.
   zod schemas in features/booking/schemas.ts (genderSchema = z.enum(["male","female"])).
2. use-seat-map.ts: refetchInterval 15_000, staleTime 5_000, key queryKeys.trips.seats(id).
3. seat-map.tsx (client): CSS grid from layout, aisle gap after aisleAfterCol, RTL-correct, السائق indicator.
   States: available (border) · selected (teal filled) · locked (muted, disabled) · booked (dark, disabled).
   Locked/booked render a small gender icon — distinct lucide icon + color per gender. Legend row includes
   both gender entries. Seat tap targets ≥40px.
4. store.ts (zustand): selectedSeats: {seatNumber, gender}[]; toggleSeat capped at the `passengers` URL
   param (default 1), gender defaults to "male"; setSeatGender(seatNumber, gender); clearSelection().
   Selection survives the 15s refetch (AC-5). If a refetch marks a selected seat locked/booked → drop it
   from selection + sonner toast.
5. Sticky bottom bar: one chip per selected seat (seat number + ذكر/أنثى segmented toggle, AC-4),
   total price = price × N, "متابعة" button disabled until N seats selected. Button does nothing yet.

NOT in this task: lock request, checkout, any mutation.

Verify: npm run build; at 375px seats are tappable and gender icons legible; selecting 2 seats with
different genders survives a full 15s refetch cycle.
```

---

## Task 12 — Seat locking (PAS-4 AC-6, PAS-5 AC-3)

```
Wire the lock flow per docs/BACKEND_V1.md §3.
IMPORTANT: no HTTP status codes anywhere. Conflicts are ok:false envelopes with HTTP 200.

SCOPE:
  src/mocks/handlers.ts
  src/features/booking/{api.ts, schemas.ts, store.ts, components/*}
  src/app/booking/checkout/page.tsx (placeholder)

1. MSW:
   - POST /api/trips/:id/seats/lock  body { seats: [{seatNumber, gender}] }
       success → ok({ lockId, expiresAt: now+10min })
       seat "13" always → fail("SEAT_ALREADY_LOCKED", "تم حجز بعض المقاعد للتو", { seats: ["13"] })
       already-booked seat → fail("SEAT_ALREADY_BOOKED", ..., { seats: [...] })
   - POST /api/locks/:lockId/release → ok(null). Idempotent: releasing a gone lock still returns ok.
   Keep a module-level Map of locked seats WITH gender inside handlers so subsequent GET /seats reflects
   them (gender visible to other viewers). Expire entries after 10min on read.
2. booking/api.ts: lockSeats(tripId, seats) and releaseLock(lockId) — both through unwrap().
3. "متابعة" → useMutation:
   - success: store lockId + lockExpiresAt in the booking store, router.push('/booking/checkout')
   - ApiError.code === "SEAT_ALREADY_LOCKED" | "SEAT_ALREADY_BOOKED": read error.details.seats,
     remove them from selection, flash a destructive ring on those seats, toast
     "تم حجز بعض المقاعد للتو، اختر مقاعد أخرى", invalidate queryKeys.trips.seats(id), STAY on the page.
   - any other code: generic toast "حدث خطأ، حاول مجدداً".
4. Best-effort release (PAS-5 AC-3): on route leave / beforeunload while holding a lock without a
   completed booking → fire-and-forget releaseLock. Must not block navigation.
5. /booking/checkout placeholder page printing store state (real page = Task 13).

Verify: seat 13 + متابعة shows the full conflict recovery UX and stays on the page; locking seats 5+6 as
أنثى then reloading shows them locked with female icons; navigating back frees them.
```

---

## Task 13 — Checkout + countdown (PAS-5, PAS-6 minus OTP)

```
Build /booking/checkout per USER_STORIES.md PAS-5 + PAS-6. Pure guest flow — no login/OTP step (AC-4).

SCOPE:
  src/app/booking/checkout/page.tsx
  src/features/booking/components/{lock-countdown.tsx, passenger-form.tsx, order-summary.tsx}
  src/features/booking/schemas.ts (passenger schema)

1. Guard: no lockId in store → redirect home.
2. lock-countdown.tsx: mm:ss derived from lockExpiresAt, recomputed from Date.now() on a 1s tick
   (never a setTimeout duration). Destructive style under 2:00. At 0 → shadcn Dialog "انتهت مهلة الحجز",
   single action "العودة لاختيار المقاعد" → release lock + clear lock state + router.push back to the trip.
   Sticky across the page.
3. Passenger forms: react-hook-form + zod, one card per selected seat (seat number as title).
   fullName (min 3) · phone (^\+9639\d{8}$) with Arabic error messages · gender as a READ-ONLY badge
   pre-filled from the seat selection (PAS-6 AC-2) + hint "لتغيير الجنس عد لاختيار المقاعد".
   Checkbox "نفس الرقم لجميع الركاب" propagates the first phone; unchecking restores editability.
4. Payment: single option "الدفع في المكتب" (radio checked + disabled, with explainer). No other method.
5. Order summary: trip, seats with gender badges, price × N, total. "تأكيد الحجز" does nothing yet.

NOT in this task: createBooking, confirmation page.

Verify: temporarily shorten the mock lock to 30s → countdown reaches 0, dialog appears, returns to the
seat map with the lock released. Then restore 10min.
```

---

## Task 14 — Booking creation + ticket (PAS-6 AC-5/6/7, PAS-7)

```
Complete the flow per docs/BACKEND_V1.md §4.
Idempotency travels in the BODY as idempotencyKey (uuid) — NOT as an HTTP header. RPCs have no headers,
so the MSW contract must already match the Supabase one.

SCOPE:
  src/mocks/handlers.ts
  src/features/booking/{api.ts, schemas.ts, store.ts}
  src/app/booking/confirmation/page.tsx (+ ticket components)

1. MSW POST /api/bookings, body { lockId, idempotencyKey, paymentMethod: "cash", passengers: [...] }:
   - idempotency first: same key → replay the stored response from a Map (never a second booking).
     Same key + different body → fail("IDEMPOTENCY_CONFLICT", ...)
   - lock missing/expired/foreign → fail("LOCK_EXPIRED", "انتهت مهلة الحجز")
   - passenger gender ≠ the gender declared on that seat's lock → fail("VALIDATION_ERROR", ..., { field })
   - deterministic anti-abuse demo: any passenger phone ending in "00" →
     fail("BOOKING_LIMIT_REACHED", "تجاوزت الحد المسموح من الحجوزات")
   - success → ok({ id, pnr, status:"confirmed", qrPayload, trip, passengers (with gender), totalPrice })
     pnr = 6 chars from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0/O/1/I). Consume the lock on success.
   Booking zod schema in features/booking/schemas.ts.
2. api.ts createBooking(payload): idempotencyKey is generated ONCE per checkout attempt
   (crypto.randomUUID stored in the booking store) and reused on every retry of that attempt.
3. "تأكيد الحجز": useMutation, disabled while pending (double-submit protection).
   - success: keep booking in store, clear lock state, router.replace('/booking/confirmation')
   - "LOCK_EXPIRED": same dialog/flow as countdown-zero (AC-6)
   - "BOOKING_LIMIT_REACHED" / "VALIDATION_ERROR": toast the server message, stay on the page
4. /booking/confirmation: success header · PNR prominent + copy button · QR via qrcode.react(qrPayload)
   · trip summary · passengers table (seat, name, gender, phone) · total
   · notice "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" · CTA "العودة للرئيسية".
   Guard: no booking in store → redirect home.

Verify: throttle to Slow 3G, triple-tap تأكيد → exactly one booking (check the handler's Map size in
console); browser back from confirmation does not return to checkout.
```

---

## Task 15 — Phase B hardening pass

```
Polish pass over the booking flow. No new features, no new routes.

1. Error handling audit: grep src/ for "response?.status", "err.status", "status ===" → must be ZERO hits
   (all UX keys on ApiError.code). Any unhandled code → generic toast "حدث خطأ، حاول مجدداً".
2. Loading/disabled audit: seat map skeleton, lock button pending state, checkout submit spinner,
   confirmation render while the store hydrates.
3. Back-navigation matrix: checkout → back → seat map keeps selection incl. genders, lock released,
   re-lock on متابعة works. Confirmation → back does NOT return to checkout.
4. RTL audit of new screens (no pl-/pr-/ml-/mr- outside components/ui; chevron/arrow direction).
   Gender icon + color identical across map, selection bar, checkout badges, ticket table.
5. Full sweep at 375px and 1440px: happy path · conflict path (seat 13) · expiry path · limit path
   (phone ending 00) · idempotency path. Run prettier.

Verify: npm run build clean; report anything found but not fixed.
```

---

# Phase E — Supabase cutover

**Precondition:** backend staging live. E1+E2 need backend **M2** done; E3 needs **M4**.
Swap one feature per task; MSW stays on for everything not yet swapped.

## Task E1 — Supabase client (shrunk — `unwrap` already exists)

```
1. npm i @supabase/supabase-js.
2. src/lib/supabase.ts: browser client from env (already required in config/env.ts). This file and
   features/*/api.ts are the ONLY places importing @supabase/supabase-js.
3. Copy naql-db's types/database.ts → src/types/database.ts; document the sync step in README.
4. src/lib/rpc.ts: callRpc(name, args, schema) = supabase.rpc() + reuse unwrap() from lib/envelope.ts.
   Do NOT reimplement the envelope logic — it is shared with the MSW path.
No feature swapped yet. Verify: npm run build, and one manual callRpc against staging in a scratch page.
```

## Task E2 — Swap catalog + search

```
Rewrite src/features/search/api.ts internals ONLY:
  getCities  → supabase.from("cities").select()
  searchTrips → callRpc("search_trips", { from_slug, to_slug, travel_date, passengers }, schema)
  getTrip     → callRpc("get_trip", { trip_id }, schema)
Signatures, zod schemas, hooks, components unchanged. Remove the search/cities MSW handlers.
Verify /search + /trips/[id] against the staging seed; diff any field-shape mismatch and report it as a
BACKEND_V1 doc issue rather than patching the frontend schema silently.
```

## Task E3 — Swap booking (locks + bookings)

```
Rewrite src/features/booking/api.ts:
  lockSeats     → callRpc("lock_seats", { p_trip_id, p_seats })
  releaseLock   → callRpc("release_lock", { p_lock_id })
  createBooking → callRpc("create_booking", { p_lock_id, p_idempotency_key, p_payment_method, p_passengers })
  cancelBooking → callRpc("cancel_booking", { p_booking_id })
Ensure an anonymous session exists before the first lock (supabase.auth.signInAnonymously() if none).
Remove booking MSW handlers.
Verify on staging: happy path · real concurrent conflict (two browsers, same seat) · LOCK_EXPIRED via QA
script · double-tap idempotency · gender visible cross-browser on locked seats.
```

## Task E4 — My tickets + PNR lookup (PAS-10, PAS-11)

```
1. /tickets (رحلاتي): supabase.from("bookings") — RLS scopes to the anonymous session. Tabs القادمة/السابقة,
   newest first, paginated. Empty state explains tickets are per-device + links to /tickets/lookup.
2. /tickets/[id]: full ticket with QR (reuse confirmation components).
3. /tickets/lookup: PNR (6 chars, uppercased on input) + phone (+963 regex) → callRpc("lookup_booking").
   NOT_FOUND → "تأكد من رقم الحجز ورقم الهاتف" — never reveal which field was wrong.
4. Header nav "رحلاتي" links to lookup when the local list is empty. Remove any passenger auth placeholder.
```

## Task E5 — (Optional, post-launch) Realtime seat map

```
Replace the 15s polling in use-seat-map.ts with a Supabase Realtime subscription on seat_lock_seats +
booking_passengers filtered by trip_id, invalidating queryKeys.trips.seats(id) on any event.
Keep polling as fallback when the channel errors. Verify: a lock in browser A appears in browser B < 2s.
```

---

## Prompting rules

1. One vertical slice per task — ≤ ~6 files, listed explicitly in the prompt.
2. Reference docs by path; the agent reads them itself. Never paste contracts into prompts.
3. Always state what NOT to build — scope creep is the main token burner.
4. CLAUDE.md carries the conventions so prompts never repeat envelope/RTL/zod/gender rules.
5. End every risky task with a concrete verification step (build + a specific manual check).
6. Wrong output → revert, tighten, rerun. Never patch a bad task with follow-ups in the same session.

## Sequencing

```
9.5 → 10 → 11 → 12 → 13 → 14 → 15        (frontend, MSW)
   ‖  B0 → B1 → B2 ────────────────► staging live → E1 → E2
                  B3 → B4 ──────────────────────────────► E3 → E4
```

- Task 15 lands **before** Phase E — enter the cutover with UX you trust, so every failure is a shape mismatch.
- After Task 14, demo script: search → filter → trip → pick seats + genders (incl. seat 13 conflict) →
  checkout → let it expire once → rebook → confirm → double-tap test → reload map shows genders.
- Phase C is now just Task E4. Operator email login opens Phase D.
- If passenger OTP returns in v1.1: anonymous identity linking (BACKEND_V1 §1) — zero rework in checkout.