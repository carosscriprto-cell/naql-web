# Claude Code — Task Prompts (Phase A: Homepage)

## How to use

- Run tasks **in order**, one per session/message. Small scoped tasks = better output, fewer tokens, easy review.
- Before Task 1, create `CLAUDE.md` at repo root (below). It gives the agent persistent context so every prompt stays short.
- After each task: review the diff, run `npm run dev`, commit. Never stack two tasks in one prompt.

---

## 0) CLAUDE.md (put at repo root — copy as-is)

```md
# Project: naql-web — intercity bus booking platform (Syria), Arabic RTL, mobile-first.

Stack: Next.js App Router + TS + Tailwind + shadcn/ui + TanStack Query + next-intl (ar default).

Rules:

- RTL: html dir="rtl". Use logical utilities (ps-, pe-, ms-, me-, start-, end-). Never pl-/pr-.
- Server Components by default. "use client" only when interactive.
- Components never import axios. Data via feature hooks only (features/*/hooks).
- All API responses zod-parsed in features/*/api.ts. Query keys from src/lib/query-keys.ts only.
- Mock data only in src/mocks/. Prices are integer SYP. Dates ISO UTC, displayed via date-fns.
- UI text in Arabic via next-intl messages (src/messages/ar.json) — no hardcoded strings in JSX.
- Keep components < ~120 lines; extract when larger.
- Design: clean, trustworthy, primary color teal-700 range, generous whitespace, cards with subtle borders (not heavy shadows).
- use skills from skills folder
```

---

## Task 1 — Scaffold & config --done

```
Follow docs/SETUP.md exactly: create the folder structure (section 6), add the core lib files (section 7: query-client, api-client, query-keys, QueryProvider), env validation (section 5), and .prettierrc. Wire QueryProvider in src/app/layout.tsx with <html lang="ar" dir="rtl">, load an Arabic font via next/font (IBM Plex Sans Arabic), and set up next-intl with locale "ar" and an empty src/messages/ar.json. Add npm scripts: "format": "prettier --write .". Do not build any UI. don not run `npm run dev` or build
if there step mark with --done just verify is done
```

## Task 2 — Domain types + mock data --done

```
Create src/types/domain.ts with TS types matching docs/BACKEND_V1.md sections 2–4 exactly: City, Company, TripSearchItem, SeatMap, Seat, Booking. Create src/features/search/schemas.ts with zod schemas for City and TripSearchItem (types inferred from zod, re-exported).

Create src/mocks/data.ts: 6 Syrian cities (دمشق, حلب, حمص, اللاذقية, دير الزور, طرطوس) with slugs; 3 companies (Arabic names, rating 4.2–4.8, placeholder logoUrl); 12 TripSearchItem entries across دمشق→حلب, دمشق→حمص, دمشق→اللاذقية with realistic times (ISO UTC), prices 60000–120000 SYP, busType "عادي" | "VIP", availableSeats 5–40. Export helpers: getCities(), getPopularRoutes() (4 routes with fromCity, toCity, minPrice, tripsPerDay), searchTrips(from,to,date).

No UI in this task.
```

## Task 3 — Header + Footer + page shell --done

```
Create src/components/shared/header.tsx and footer.tsx (Server Components).
Header: sticky, logo text "النقل الذكي" (linked to /), nav links: الرئيسية, رحلاتي, للشركات — plus a "تسجيل الدخول" Button (shadcn, links to /auth/login, page can 404 for now). Mobile: nav collapses into a shadcn Sheet triggered by a menu icon (this small part is a client component).
Footer: 3 columns — about blurb, quick links, contact placeholders — plus copyright bar.
All strings from src/messages/ar.json via next-intl. Add both to the (public) layout. Empty home page renders between them.
```

## Task 4 — Hero + SearchForm --done

```
Build the homepage hero in src/app/(public)/page.tsx + src/features/search/components/search-form.tsx (client component).

Hero: headline "احجز رحلتك بين المدن بضغطة واحدة", subline, subtle gradient background (teal-900→teal-700), SearchForm in an elevated card overlapping the hero bottom edge.

SearchForm: react-hook-form + zod. Fields: from (shadcn Select fed by getCities() through a useCities React Query hook in src/features/search/hooks/use-cities.ts backed by a mock-mode api.ts that resolves src/mocks/data.ts), to (Select, excludes selected from), date (shadcn Calendar in Popover, min today, formatted with date-fns ar locale), passengers (Select 1–5). Swap-cities icon button between from/to. Submit → router.push(`/search?from=&to=&date=&passengers=`) — the /search page itself is NOT part of this task; create a placeholder page that just prints the query params.

Layout: single column on mobile, one row on lg. Validation messages in Arabic.
```

## Task 5 — Popular routes + How it works

```
Two homepage sections under the hero:

1) src/features/search/components/popular-routes.tsx (Server Component): grid of 4 cards from getPopularRoutes() — fromCity ← arrow → toCity (RTL-correct arrow), "ابتداءً من {minPrice} ل.س", "{tripsPerDay} رحلة يومياً", card links to prefilled /search URL. 2 cols mobile, 4 cols lg.

2) "كيف تحجز رحلتك؟" section: 3 steps with lucide icons (Search, Armchair, TicketCheck) — ابحث عن رحلتك / اختر مقعدك / استلم تذكرتك الإلكترونية. Horizontal on lg, vertical on mobile, connected by a dashed line.

Strings in ar.json. Use existing Card/Badge from shadcn.
```

## Task 6 — Trust strip + companies + polish

```
Finish the homepage:
1) Stats strip: 4 items (شركة نقل +10, رحلة يومياً +150, مدينة 6, مقعد محجوز +25,000) — bold number, small label, bordered top/bottom section.
2) "شركاؤنا" section: 3 company cards from mocks (name, rating with star icon, tripsCount) linking to /companies/[slug] placeholder page.
3) Final CTA band: "هل تملك شركة نقل؟ انضم إلى المنصة" + Button (links to /operator placeholder).
4) Polish pass: consistent section spacing (py-16 lg:py-24), max-w-6xl container, loading skeletons for the cities Select, verify everything at 375px and 1440px widths, run prettier.
```

## Task 7 — MSW wiring (prepares Phase B, still homepage-safe)

```
Set up MSW: src/mocks/handlers.ts implementing GET /cities and GET /trips/search per docs/BACKEND_V1.md response shapes (reuse src/mocks/data.ts), src/mocks/browser.ts, and a client MockProvider that starts the worker only when env.NEXT_PUBLIC_USE_MOCKS === "true". Run `npx msw init public/`. Refactor src/features/search/api.ts to call the axios api client (real HTTP → intercepted by MSW) instead of importing mock data directly, with zod parsing of responses. useCities behavior must remain identical from the UI's perspective.
```

---

## Prompting rules that keep quality high & tokens low

1. **One vertical slice per task** — a task touches ≤ ~6 files.
2. **Reference docs by path** (`docs/BACKEND_V1.md`) instead of pasting contracts into prompts — the agent reads them itself.
3. **State what NOT to build** (e.g. "search page is not part of this task") — prevents scope creep, the main token burner.
4. **CLAUDE.md carries the conventions** so prompts never repeat RTL/zod/query rules.
5. End risky tasks with a verification step ("verify npm run dev", "verify at 375px").
6. If a task output is wrong, don't patch with follow-ups in the same session — revert, tighten the prompt, rerun.


# Claude Code — Task Prompts (Phase B: Search → Seats → Checkout → Ticket)

Same rules as Phase A: one task per session, review diff, `npm run dev`, commit. Reference docs by path.

## 0) Append to CLAUDE.md (before Task 8)

```md
## Booking flow rules (Phase B)
- Booking flow client state lives in ONE zustand store: src/features/booking/store.ts
  (selectedSeats, lockId, lockExpiresAt, passengers). No booking state in URL or context.
- Seat map: poll every 15s (refetchInterval), staleTime 5s, key queryKeys.trips.seats(id).
- All error handling keyed on backend `code` field (docs/BACKEND_V1.md §0), never on message text.
- MSW handlers must simulate failure paths (409 lock conflict, 410 LOCK_EXPIRED) behind
  deterministic triggers so they're demoable (e.g. seat "13" always conflicts).
- Countdown derives from lockExpiresAt (server time), never from a local setTimeout duration.
```

---

## Task 8 — Search results page (PAS-1) --done

```
Build /search per docs/USER_STORIES.md PAS-1 and docs/BACKEND_V1.md §2.

1. src/app/(public)/search/page.tsx: reads from/to/date/passengers from searchParams (replace the Phase A placeholder). Server Component shell; results list is a client component.
2. src/features/search/hooks/use-search-trips.ts: useQuery with queryKeys.trips.search(params), calls GET /trips/search via api.ts (MSW already intercepts — extend src/mocks/handlers.ts to filter src/mocks/data.ts by from/to/date).
3. src/features/search/components/trip-card.tsx: company logo+name+rating, departure/arrival times (date-fns ar), duration, price (ل.س formatted with thousands separator), busType badge, availableSeats, CTA "اختر المقاعد" → /trips/[id]?passengers=N.
4. Loading: 4 skeleton cards. Empty state: illustration-free card with "لا توجد رحلات في هذا التاريخ" + button suggesting next day (PAS-1 AC-4).
5. Search summary bar at top (from ← to، date، passengers) with "تعديل" that expands the existing SearchForm inline.

Not in this task: filters/sort (Task 9), trip details page.
Verify: /search?from=damascus&to=aleppo&date=<tomorrow> renders mock trips at 375px.
```

## Task 9 — Filters & sort (PAS-2) --done

```
Add filtering/sorting to /search per docs/USER_STORIES.md PAS-2.

1. src/features/search/components/search-filters.tsx (client): departure window chips (صباح 05-12 / ظهر 12-17 / مساء 17-24), company multi-select (derived from current results), busType toggle (عادي/VIP), sort Select (الأبكر مغادرةً default / الأقل سعراً).
2. All filter/sort state lives in URL params (AC-3) via useRouter.replace + useSearchParams — no local state duplication. Filtering is client-side over the fetched result set.
3. Mobile: filters inside a shadcn Sheet triggered by "تصفية" button with active-filter count badge. Desktop (lg): sidebar start-side.
4. Result count line: "N رحلة متاحة".

Verify: applying filters updates URL, reload preserves filters, clearing works.
```

## Task 10 — Trip details page (PAS-3)

```
Build /trips/[id] per docs/USER_STORIES.md PAS-3.

1. Extend src/mocks/handlers.ts: GET /trips/:id returning full trip (reuse search item shape + cancellationPolicy text). Add zod schema in src/features/search/schemas.ts.
2. src/app/(public)/trips/[id]/page.tsx: trip header (route, times, duration, company card with rating), price per seat, cancellation policy callout ("الإلغاء مجاني حتى ساعتين قبل الانطلاق"), and a placeholder section "اختيار المقاعد" (seat map is Task 11).
3. Disabled states (AC-2): if departureAt < now → CTA disabled "انطلقت الرحلة"; if availableSeats === 0 → "اكتملت المقاعد". Add one mock trip for each case.
4. src/features/search/hooks/use-trip.ts with queryKeys.trips.detail(id).

Not in this task: seat map, locking.
```

## Task 11 — Seat map (PAS-4, rendering + selection only)

```
Build the interactive seat map inside /trips/[id] per docs/BACKEND_V1.md §3 and USER_STORIES.md PAS-4 AC-1..3.

1. MSW: GET /trips/:id/seats returning { layout: {rows, cols, aisleAfterCol}, seats: [...] } — generate a 12x4 map in src/mocks/data.ts with a mix of available/locked/booked. Zod schemas in src/features/booking/schemas.ts.
2. src/features/booking/hooks/use-seat-map.ts: refetchInterval 15_000, staleTime 5_000, key queryKeys.trips.seats(id).
3. src/features/booking/components/seat-map.tsx (client): CSS grid from layout, gap column after aisleAfterCol, RTL-correct. Seat states: available (border), selected (teal filled), locked (muted + disabled), booked (dark + disabled). Legend row. Front-of-bus indicator (السائق).
4. Selection logic in src/features/booking/store.ts (zustand): toggleSeat capped at `passengers` URL param; selection survives the 15s refetch (AC-3) — but if a refetch marks a selected seat locked/booked, drop it from selection + toast (sonner).
5. Sticky bottom bar: selected seats + total price + "متابعة" button (disabled until N seats selected). Button does nothing yet.

Not in this task: lock API call (Task 12).
Verify at 375px: seats are tappable ≥40px targets.
```

## Task 12 — Seat locking (PAS-4 AC-4)

```
Wire the lock flow per docs/BACKEND_V1.md §3.

1. MSW: POST /trips/:id/seats/lock → 201 { lockId, expiresAt: now+10min }, but seat "13" always returns 409 SEAT_ALREADY_LOCKED with details.seats:["13"] (deterministic demo of conflicts). DELETE /locks/:lockId → 204. Track locked seats in a module-level Map inside handlers so subsequent GET /seats reflects them.
2. src/features/booking/api.ts: lockSeats(tripId, seatNumbers), releaseLock(lockId) — zod-parsed.
3. "متابعة" → useMutation: on 201 store lockId+lockExpiresAt in the booking store and router.push('/booking/checkout?tripId=...'). On 409: read error.details.seats, remove them from selection, highlight them briefly (ring-destructive animation), toast "تم حجز بعض المقاعد للتو، اختر مقاعد أخرى", invalidate seat map query, stay on page (AC-4).
4. Best-effort release: on route leave / beforeunload while holding a lock without a completed booking → DELETE /locks/:lockId (navigator.sendBeacon-style fire-and-forget is fine with axios; don't block navigation).
5. Create /booking/checkout placeholder page that prints store state.

Verify: selecting seat 13 + متابعة shows the full 409 recovery UX.
```

## Task 13 — Checkout + countdown (PAS-5, PAS-6 minus OTP)

```
Build /booking/checkout per USER_STORIES.md PAS-5, PAS-6 (skip AC-3/OTP — Phase C; leave a TODO slot in the flow).

1. Guard: no lockId in store → redirect to home.
2. src/features/booking/components/lock-countdown.tsx: mm:ss derived from lockExpiresAt (recompute from Date.now(), tick 1s). Turns destructive under 2:00. At 0 → shadcn Dialog "انتهت مهلة الحجز" with single action "العودة لاختيار المقاعد" → clear store + router.push back to /trips/[id] (AC-2). Countdown visible in a sticky header across the checkout page.
3. Passenger forms: react-hook-form + zod, one card per selected seat (seat number as card title). Fields: fullName (required, min 3), phone (regex ^\+9639\d{8}$, Arabic error messages). First passenger phone pre-fills others via "نفس الرقم لجميع الركاب" checkbox.
4. Payment section: single fixed option "الدفع في المكتب" (radio checked+disabled, with explainer note) per AC-2.
5. Order summary card: trip, seats, price × N, total. "تأكيد الحجز" button does nothing yet (Task 14).

Verify: expiry dialog by temporarily mocking a 30s lock.
```

## Task 14 — Booking creation + ticket (PAS-6 AC-4/5, PAS-7)

```
Complete the flow per docs/BACKEND_V1.md §4.

1. MSW: POST /bookings — requires Idempotency-Key header; same key returns the same stored response (Map in handler). Generates pnr (6 chars, no 0/O/1/I), qrPayload string, echoes passengers + totalPrice. If lock older than 10min → 410 LOCK_EXPIRED. Zod schema for Booking in src/features/booking/schemas.ts.
2. src/features/booking/api.ts createBooking: generates one Idempotency-Key per checkout attempt (crypto.randomUUID stored in the booking store, reused on retry of the same attempt), sends { lockId, paymentMethod: "cash", passengers }.
3. "تأكيد الحجز": useMutation with double-submit protection (disabled while pending). 201 → clear lock state, keep booking result in store, router.replace('/booking/confirmation'). 410 LOCK_EXPIRED → same dialog/flow as countdown-zero (PAS-6 AC-5).
4. /booking/confirmation: success header, PNR prominent (copyable), QR via qrcode.react (qrPayload), trip summary, passengers+seats table, total, notice "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" (PAS-7 AC-1). CTA: "العودة للرئيسية". Guard: no booking in store → redirect home.

Verify: double-click تأكيد creates exactly one booking (check MSW console logs).
```

## Task 15 — Phase B hardening pass

```
Polish pass over the whole booking flow, no new features:
1. Every mutation/query error without a handled `code` → generic toast "حدث خطأ، حاول مجدداً".
2. Loading/disabled states audit: seat map skeleton, checkout submit spinner, confirmation while store hydrates.
3. Back-navigation matrix: checkout → back → seat map keeps selection but lock released + re-lock on متابعة; confirmation → back does NOT return to checkout (router.replace verified).
4. RTL audit of the new screens (no pl-/pr-, arrows/chevrons direction).
5. Verify full happy path + 409 path + expiry path at 375px and 1440px. Run prettier.
```

---

## Sequencing notes

- Tasks 8–10 are parallel-safe with backend work; 11–14 are the critical path.
- After Task 14, the demo script is: search → filter → trip → pick seats (incl. seat 13 conflict) → checkout → expire once → rebook → confirm → double-tap test.
- Phase C (OTP + رحلاتي) slots into checkout at the marked TODO — no rework needed if PAS-6 AC-3 stays inline.