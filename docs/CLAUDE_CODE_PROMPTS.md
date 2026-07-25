# Claude Code — Task Prompts

**Status:** Tasks 1–9 done (Phase A + search results + filters). Nothing built so far changes.
**Backend decision:** Supabase (see docs/BACKEND_V1.md + docs/BACKEND_EXECUTION_PLAN.md). Strategy: **MSW mocks stay through Phases B–D exactly as planned** — only Phase E swaps `features/*/api.ts` internals to supabase-js. Components, hooks, zod schemas, error handling survive untouched.
**New feature:** gender (ذكر/أنثى) per passenger, displayed on locked/booked seats — woven into Tasks 11–14 below.
**Scope change:** passenger OTP removed from v1 — checkout is pure guest flow (anonymous session), tickets via device-local list + PNR lookup. Operator/admin use email+password (Phase D).

## How to use

- Run tasks **in order**, one per session/message. Small scoped tasks = better output, fewer tokens, easy review.
- After each task: review the diff, run `npm run dev`, commit. Never stack two tasks in one prompt.

---

## 0) CLAUDE.md updates (apply before Task 10)

Append to the existing CLAUDE.md:

```md
## Booking flow rules (Phase B)
- Booking flow client state lives in ONE zustand store: src/features/booking/store.ts
  (selectedSeats: {seatNumber, gender}[], lockId, lockExpiresAt, passengers). No booking state in URL or context.
- Gender: enum "male" | "female". Locked/booked seats render a gender indicator.
  Selected seats default to "male", toggleable in the selection bar. Gender is sent with the lock request.
- Seat map: poll every 15s (refetchInterval), staleTime 5s, key queryKeys.trips.seats(id).
- All error handling keyed on backend `code` field (docs/BACKEND_V1.md §0), never on message text.
- MSW handlers must simulate failure paths (409 lock conflict, 410 LOCK_EXPIRED) behind
  deterministic triggers so they're demoable (e.g. seat "13" always conflicts).
- Countdown derives from lockExpiresAt (server time), never from a local setTimeout duration.

## Backend target (Phase E)
- Real backend is Supabase. api.ts functions keep their current signatures; in Phase E their
  internals switch to supabase-js (PostgREST reads + rpc() writes). Do NOT leak supabase types
  into components — domain types come from features/*/schemas.ts only.
```

---

## Task 10 — Trip details page (PAS-3)

```
Build /trips/[id] per docs/USER_STORIES.md PAS-3.

1. Extend src/mocks/handlers.ts: GET /trips/:id returning full trip (reuse search item shape + cancellationPolicy text). Add zod schema in src/features/search/schemas.ts.
2. src/app/(public)/trips/[id]/page.tsx: trip header (route, times, duration, company card with rating), price per seat, cancellation policy callout ("الإلغاء مجاني حتى ساعتين قبل الانطلاق"), and a placeholder section "اختيار المقاعد" (seat map is Task 11).
3. Disabled states (AC-2): if departureAt < now → CTA disabled "انطلقت الرحلة"; if availableSeats === 0 → "اكتملت المقاعد". Add one mock trip for each case.
4. src/features/search/hooks/use-trip.ts with queryKeys.trips.detail(id).

Not in this task: seat map, locking.
```

## Task 11 — Seat map (PAS-4, rendering + selection + gender)

```
Build the interactive seat map inside /trips/[id] per docs/BACKEND_V1.md §3 and USER_STORIES.md PAS-4 AC-1..5.

1. MSW: GET /trips/:id/seats returning { layout: {rows, cols, aisleAfterCol}, seats: [...] } — generate a 12x4 map in src/mocks/data.ts with a mix of available/locked/booked, where every locked/booked seat carries gender: "male" | "female" (mix both). Zod schemas in src/features/booking/schemas.ts (gender as z.enum).
2. src/features/booking/hooks/use-seat-map.ts: refetchInterval 15_000, staleTime 5_000, key queryKeys.trips.seats(id).
3. src/features/booking/components/seat-map.tsx (client): CSS grid from layout, gap column after aisleAfterCol, RTL-correct. Seat states: available (border), selected (teal filled), locked (muted + disabled), booked (dark + disabled). Locked/booked seats render a small gender icon (lucide: use distinct icons/colors for ذكر vs أنثى). Legend row includes both gender entries. Front-of-bus indicator (السائق).
4. Selection logic in src/features/booking/store.ts (zustand): selectedSeats is {seatNumber, gender}[]; toggleSeat capped at `passengers` URL param, gender defaults to "male"; setSeatGender(seatNumber, gender) action. Selection survives the 15s refetch (AC-5) — but if a refetch marks a selected seat locked/booked, drop it from selection + toast (sonner).
5. Sticky bottom bar: one chip per selected seat showing seat number + a ذكر/أنثى segmented toggle (AC-4), total price, "متابعة" button (disabled until N seats selected). Button does nothing yet.

Not in this task: lock API call (Task 12).
Verify at 375px: seats are tappable ≥40px targets, gender icons legible.
```

## Task 12 — Seat locking (PAS-4 AC-6)

```
Wire the lock flow per docs/BACKEND_V1.md §3.

1. MSW: POST /trips/:id/seats/lock accepting { seats: [{ seatNumber, gender }] } → 201 { lockId, expiresAt: now+10min }, but seat "13" always returns 409 SEAT_ALREADY_LOCKED with details.seats:["13"] (deterministic demo of conflicts). DELETE /locks/:lockId → 204. Track locked seats WITH their gender in a module-level Map inside handlers so subsequent GET /seats reflects them (gender visible to other viewers).
2. src/features/booking/api.ts: lockSeats(tripId, seats: {seatNumber, gender}[]), releaseLock(lockId) — zod-parsed.
3. "متابعة" → useMutation: on 201 store lockId+lockExpiresAt in the booking store and router.push('/booking/checkout?tripId=...'). On 409: read error.details.seats, remove them from selection, highlight them briefly (ring-destructive animation), toast "تم حجز بعض المقاعد للتو، اختر مقاعد أخرى", invalidate seat map query, stay on page (AC-6).
4. Best-effort release: on route leave / beforeunload while holding a lock without a completed booking → DELETE /locks/:lockId (fire-and-forget; don't block navigation).
5. Create /booking/checkout placeholder page that prints store state.

Verify: selecting seat 13 + متابعة shows the full 409 recovery UX; locking seats 5+6 as أنثى then reloading shows them locked with female icons.
```

## Task 13 — Checkout + countdown (PAS-5, PAS-6 minus OTP)

```
Build /booking/checkout per USER_STORIES.md PAS-5, PAS-6. Pure guest flow — no login/OTP step anywhere (PAS-6 AC-4).

1. Guard: no lockId in store → redirect to home.
2. src/features/booking/components/lock-countdown.tsx: mm:ss derived from lockExpiresAt (recompute from Date.now(), tick 1s). Turns destructive under 2:00. At 0 → shadcn Dialog "انتهت مهلة الحجز" with single action "العودة لاختيار المقاعد" → clear store + router.push back to /trips/[id] (AC-2). Countdown visible in a sticky header across the checkout page.
3. Passenger forms: react-hook-form + zod, one card per selected seat (seat number as card title). Fields: fullName (required, min 3), phone (regex ^\+9639\d{8}$, Arabic error messages), gender shown as a read-only badge (ذكر/أنثى) pre-filled from the seat selection — NOT editable here (PAS-6 AC-2); a hint link "لتغيير الجنس عد لاختيار المقاعد". First passenger phone pre-fills others via "نفس الرقم لجميع الركاب" checkbox.
4. Payment section: single fixed option "الدفع في المكتب" (radio checked+disabled, with explainer note) per AC-3.
5. Order summary card: trip, seats (with gender badges), price × N, total. "تأكيد الحجز" button does nothing yet (Task 14).

Verify: expiry dialog by temporarily mocking a 30s lock.
```

## Task 14 — Booking creation + ticket (PAS-6 AC-5/6, PAS-7)

```
Complete the flow per docs/BACKEND_V1.md §4.

1. MSW: POST /bookings — requires Idempotency-Key header; same key returns the same stored response (Map in handler). Body passengers include gender; handler validates each passenger's gender matches the lock's declared gender (mismatch → 400 VALIDATION_ERROR — belt for the read-only UI). Generates pnr (6 chars, no 0/O/1/I), qrPayload string, echoes passengers (with gender) + totalPrice. If lock older than 10min → 410 LOCK_EXPIRED. Deterministic anti-abuse demo: passenger phone ending in "00" → 409 BOOKING_LIMIT_REACHED with Arabic-friendly message. Zod schema for Booking in src/features/booking/schemas.ts.
2. src/features/booking/api.ts createBooking: generates one Idempotency-Key per checkout attempt (crypto.randomUUID stored in the booking store, reused on retry of the same attempt), sends { lockId, paymentMethod: "cash", passengers }.
3. "تأكيد الحجز": useMutation with double-submit protection (disabled while pending). 201 → clear lock state, keep booking result in store, router.replace('/booking/confirmation'). 410 LOCK_EXPIRED → same dialog/flow as countdown-zero (PAS-6 AC-6).
4. /booking/confirmation: success header, PNR prominent (copyable), QR via qrcode.react (qrPayload), trip summary, passengers table (seat, name, gender, phone), total, notice "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" (PAS-7 AC-1). CTA: "العودة للرئيسية". Guard: no booking in store → redirect home.

Verify: double-click تأكيد creates exactly one booking (check MSW console logs).
```

## Task 15 — Phase B hardening pass

```
Polish pass over the whole booking flow, no new features:
1. Every mutation/query error without a handled `code` → generic toast "حدث خطأ، حاول مجدداً".
2. Loading/disabled states audit: seat map skeleton, checkout submit spinner, confirmation while store hydrates.
3. Back-navigation matrix: checkout → back → seat map keeps selection (incl. genders) but lock released + re-lock on متابعة; confirmation → back does NOT return to checkout (router.replace verified).
4. RTL audit of the new screens (no pl-/pr-, arrows/chevrons direction). Gender icons/colors consistent between map, selection bar, checkout badges, ticket table.
5. Verify full happy path + 409 path + expiry path at 375px and 1440px. Run prettier.
```

---

# Phase E — Supabase cutover (replaces "swap MSW → real API")

Precondition: backend staging live through M4 (see docs/BACKEND_EXECUTION_PLAN.md). Swap **one feature per task**; MSW stays on for everything not yet swapped (env flag per feature if needed).

## Task E1 — Supabase client + generated types

```
1. npm i @supabase/supabase-js. Add NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY to src/config/env.ts (zod) and .env.local.
2. src/lib/supabase.ts: browser client (createBrowserClient pattern) — the ONLY file that imports @supabase/supabase-js besides api.ts files.
3. Copy backend repo's types/database.ts into src/types/database.ts (document the sync step in README).
4. src/lib/rpc.ts: helper `callRpc(name, args, schema)` — invokes supabase.rpc, unwraps the { ok, data | error } envelope, throws ApiError { code, message, details } on ok:false, zod-parses data. This preserves every existing code-keyed error handler.
No feature swapped yet. Verify build passes.
```

## Task E2 — Swap catalog + search

```
Rewrite src/features/search/api.ts internals only: getCities via supabase.from("cities"), searchTrips/getTrip via callRpc("search_trips"/"get_trip"). Signatures, zod schemas, hooks, components unchanged. Set NEXT_PUBLIC_USE_MOCKS=false path for these endpoints (remove their MSW handlers). Verify /search + /trips/[id] against staging seed.
```

## Task E3 — Swap booking (locks + bookings)

```
Rewrite src/features/booking/api.ts: lockSeats → callRpc("lock_seats"), releaseLock → callRpc("release_lock"), createBooking → callRpc("create_booking", { idempotency_key }), cancelBooking → callRpc("cancel_booking"). Ensure anonymous session exists before first lock (supabase.auth.signInAnonymously() if no session). Remove booking MSW handlers. Verify on staging: happy path, real concurrent conflict (two browsers, same seat), LOCK_EXPIRED, double-tap idempotency, gender visible cross-browser on locked seats.
```

## Task E4 — My tickets + PNR lookup (PAS-10, PAS-11 — no passenger auth)

```
Implement tickets access per docs/USER_STORIES.md PAS-10/PAS-11 and docs/BACKEND_V1.md §4.

1. /tickets (رحلاتي): bookings of the current anonymous session via RLS query (supabase.from("bookings"), user_id = auth.uid() implicit). Tabs القادمة/السابقة, newest first, paginated. Empty state links to /tickets/lookup with a note that tickets are per-device.
2. /tickets/[id]: full ticket with QR (reuse confirmation components).
3. /tickets/lookup: form PNR (6 chars, uppercase) + phone (+963 regex) → callRpc("lookup_booking") → render ticket. NOT_FOUND → "تأكد من رقم الحجز ورقم الهاتف" (never say which field). Header nav "رحلاتي" now links here when no local bookings exist.
4. Remove any remaining auth placeholders from the header (تسجيل الدخول button removed for passengers — /operator login is Phase D).
```

## Task E5 — (Optional) Realtime seat map

```
Replace 15s polling in use-seat-map.ts with a Supabase Realtime subscription on seat_lock_seats + booking_passengers filtered by trip_id, invalidating queryKeys.trips.seats(id) on any event. Keep polling as fallback when the channel errors. Verify: locking a seat in browser A appears in browser B < 2s.
```

---

## Prompting rules that keep quality high & tokens low

1. **One vertical slice per task** — a task touches ≤ ~6 files.
2. **Reference docs by path** (`docs/BACKEND_V1.md`) instead of pasting contracts into prompts — the agent reads them itself.
3. **State what NOT to build** — prevents scope creep, the main token burner.
4. **CLAUDE.md carries the conventions** so prompts never repeat RTL/zod/query/gender rules.
5. End risky tasks with a verification step.
6. If a task output is wrong, don't patch with follow-ups in the same session — revert, tighten the prompt, rerun.

## Sequencing notes

- Task 10 is parallel-safe with backend work; 11–14 are the critical path.
- After Task 14, demo script: search → filter → trip → pick seats + set genders (incl. seat 13 conflict) → checkout → expire once → rebook → confirm → double-tap test → reload map shows genders on taken seats.
- Phase C shrank to Task E4 (tickets + PNR lookup) — no auth work for passengers. Operator email login is the first task of Phase D.
- If passenger OTP returns in v1.1: it slots in as anonymous identity linking (docs/BACKEND_V1.md §1) — checkout and bookings need zero rework.
