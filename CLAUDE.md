@AGENTS.md

# Project: naql-web — intercity bus booking platform (Syria). Arabic RTL, mobile-first.

Single repo. Frontend in `src/` (Next.js App Router + TS + Tailwind + shadcn/ui + TanStack Query + next-intl, `ar` default). Backend in `supabase/` (Postgres migrations + plpgsql RPCs) with tests in `tests/db/`.

Contract: `docs/BACKEND_V1.md`. Never change a response shape without updating that doc in the same commit.

---

## Transport & errors (applies to BOTH the MSW era and the Supabase era)

- Every response is the BACKEND_V1 §0 envelope, always at **HTTP 200**:
  `{ ok: true, data }` | `{ ok: false, error: { code, message, details? } }`
- Domain errors are **data, not transport failures**. A seat conflict, an expired lock, a booking-limit
  hit — all return HTTP 200 with `ok: false`. Only network/5xx failures are non-200.
- `features/*/api.ts` unwraps via `lib/envelope.ts` `unwrap()` and throws `ApiError`.
- Error UX keys on `ApiError.code` **only** — never message text, never HTTP status.
- Codes come from the fixed list in BACKEND_V1 §0.
- **Envelope rule:** RPCs with a domain failure mode return the envelope (`get_trip`, `get_seat_map`,
  all writes). `search_trips` and PostgREST table reads are bare. `api.ts` uses `unwrap()` for the
  former and `schema.parse()` for the latter.
- MSW handlers use the local `ok()` / `fail()` helpers in `src/mocks/handlers.ts` and simulate failure
  paths behind deterministic triggers: seat `"13"` always conflicts, phone ending `"00"` hits the
  booking limit.

## Frontend rules

- RTL: `html dir="rtl"`. Logical utilities only (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`). Never `pl-`/`pr-` outside `src/components/ui`.
- Server Components by default. `"use client"` only where interaction exists.
- Components never import axios or supabase. Data flows through feature hooks → `features/*/api.ts`.
- Query keys only from `src/lib/query-keys.ts`.
- Mock data only in `src/mocks/`. Prices integer SYP. Datetimes ISO UTC, displayed via date-fns.
- UI text in Arabic via next-intl (`src/messages/ar.json`) — no hardcoded strings in JSX.
- Components under ~120 lines; extract when larger.
- Design: clean and trustworthy. Primary teal-700 range, generous whitespace, cards with subtle borders (not heavy shadows).
- `src/types/database.ts` never leaks into components — domain types come from `features/*/schemas.ts`.
- Use the skills in the `skills/` folder.

## Booking flow (Phase B)

- All booking client state lives in ONE zustand store, `src/features/booking/store.ts`:
  `selectedSeats: {seatNumber, gender}[]`, `tripId`, `lockId`, `lockExpiresAt`, `idempotencyKey`, `booking`.
  No booking state in URL or context.
- Gender: enum `"male" | "female"`. Rendered on locked and booked seats, absent on available.
  Defaults to `"male"` on selection, toggleable in the selection bar, sent with the lock request,
  read-only at checkout.
- Seat map: `refetchInterval` 15s, `staleTime` 5s, key `queryKeys.trips.seats(id)`.
- Countdown derives from `lockExpiresAt` (server time), never from a local timeout duration.
- `idempotencyKey` is generated once per lock and reused on every retry of that checkout attempt.
  It travels in the request **body / RPC arguments**, never as an HTTP header.
- Toaster (sonner) is mounted once in the root layout; features call `toast()` directly.

---

# Backend rules (`supabase/` + `tests/db/`)

## Environment reality — read this before running anything

- **This machine has no working Docker.** There is no local Supabase stack here.
- The backend runs against a **hosted DEV project** (`naql-dev`) via `--linked`.
- `npm run db:reset` is **destructive** and targets DEV. That is expected: the seed is idempotent and
  DEV holds no real data. Run `npm run db:whoami` first and confirm the linked ref before every reset.
- A separate PROD project is created before launch and receives `supabase migration up` only —
  never `reset`.
- **`supabase/config.toml` does NOT apply to hosted projects.** Anonymous sign-ins ON and email signup
  OFF are configured in the dashboard and documented in README. Do not assume a config.toml change
  took effect.
- **Concurrency suites are authoritative in CI**, which runs a full local stack on the runner.
  A green run against hosted DEV is supporting evidence, not the merge gate.

## Migrations

- ALL schema/function changes via `supabase/migrations/*.sql` (`supabase migration new <name>`).
- **Never edit an applied migration** — add a new one. `npm run db:reset` must always replay cleanly from zero.
- **Never write SQL in the Supabase dashboard.** A change that isn't a migration file does not exist.
- After any schema change: `npm run db:types` (writes `src/types/database.ts`) and commit it.

## RPC conventions

- DB is snake_case. Every RPC output is camelCase JSON via `json_build_object` / `json_agg`, matching
  `docs/BACKEND_V1.md` field-for-field.
- Critical-write RPCs return the envelope:
  - ok: `jsonb_build_object('ok', true, 'data', ...)`
  - fail: `jsonb_build_object('ok', false, 'error', jsonb_build_object('code', ..., 'message', ..., 'details', ...))`
- Expected domain errors are **RETURNED, never RAISEd**. Codes only from BACKEND_V1 §0.
- All RPCs: `SECURITY DEFINER`, `SET search_path = public`, explicit auth checks inside
  (`auth.uid()` / `auth.jwt()->>'role'` / `auth.jwt()->>'company_id'`).
  Public-callable functions GRANTed to anon+authenticated explicitly; everything else REVOKEd.
- Tables: RLS enabled, deny-by-default, policies per role. Writes on core tables happen only inside RPCs.
- Money `int` (SYP), time `timestamptz` UTC, ids `uuid default gen_random_uuid()`, gender enum `('male','female')`.
- Secrets (QR HMAC) via Supabase Vault only — never in migrations or code.
- Config values (lock TTL, cancel window, booking limits) live in `app_config` and are read inside RPCs.
  Never hardcode `10` / `2` / `4` literals.

## Tests

- vitest in `tests/db/`, run via `npm run db:test`. Credentials come from `.env.test` (DEV project).
- `tests/db/helpers.ts` exports `anonClient()` (fresh anonymous session per call), `publicClient()`
  (no session), `serviceClient()` (service role, bypasses RLS — for arranging state only).
- Concurrency tests use real `Promise.all` parallel calls. No mocks, ever.

## Executable reference

`src/mocks/handlers.ts` is the spec the frontend was built and QA'd against. Before implementing
`lock_seats` (B3) or `create_booking` (B4), read those handlers and match them field-for-field.
Any divergence you believe is necessary → stop and raise it before writing the migration.
