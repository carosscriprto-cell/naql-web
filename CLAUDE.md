@AGENTS.md

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
- Booking flow client state lives in ONE zustand store: src/features/booking/store.ts
  (selectedSeats, lockId, lockExpiresAt, passengers). No booking state in URL or context.
- Seat map: poll every 15s (refetchInterval), staleTime 5s, key queryKeys.trips.seats(id).
- All error handling keyed on backend `code` field (docs/BACKEND_V1.md §0), never on message text.
- MSW handlers must simulate failure paths (409 lock conflict, 410 LOCK_EXPIRED) behind
  deterministic triggers so they're demoable (e.g. seat "13" always conflicts).
- Countdown derives from lockExpiresAt (server time), never from a local setTimeout duration.