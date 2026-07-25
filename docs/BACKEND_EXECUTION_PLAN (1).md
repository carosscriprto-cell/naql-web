# Backend Execution Plan — naql (v1, Supabase)

**Replaces the ASP.NET Core plan entirely.**
**Stack (locked):** Supabase (hosted) · Postgres 15 · plpgsql RPCs · RLS · Supabase Auth · Supabase CLI for local dev & migrations.
**Contract source of truth:** `docs/BACKEND_V1.md` (Supabase edition). Any shape change = PR on that file first, agreed with frontend, then a migration.
**Frontend consumes:** `@supabase/supabase-js` — PostgREST for reads, `rpc()` for critical writes. All error UX keyed on the RPC envelope `error.code`.

---

## 0. Architecture at a glance

```
naql-web (Next.js)                      Supabase project
      │  supabase-js                          │
      ├── reads ───────► PostgREST + RLS ──►  Postgres
      ├── writes ──────► rpc() ────────────►  plpgsql functions (ALL critical logic)
      ├── auth ────────► Supabase Auth (passengers: anonymous · operators/admins: email+password)
      └── realtime ────► (optional) seat map subscriptions
                          Edge Functions: none needed in v1 (no OTP, no external providers)
```

Principles:
- **One repo for backend:** `naql-db/` — migrations, functions, seed, tests. No app server. No Redis (Postgres does locks, idempotency, rate limiting).
- **Critical logic in the DB (RPC), never in the client, never in Edge Functions.** Atomicity and constraints live where the data lives.
- Expected domain errors are **returned** in the envelope, not raised — frontend keeps its `code`-driven UX untouched.

## 1. Repository layout

```
naql-db/
├── supabase/
│   ├── migrations/            # numbered SQL — the real contract
│   ├── functions/             # Edge Functions (empty unless custom OTP)
│   ├── seed.sql               # idempotent seed (BACKEND_V1 §7)
│   └── config.toml
├── tests/
│   ├── rpc/                   # vitest against `supabase start` (local stack)
│   └── concurrency/           # parallel lock/booking suite — merge gate from M2
├── types/database.ts          # `supabase gen types` output, committed
├── .github/workflows/ci.yml
└── README.md
```

## 2. Conventions

- snake_case in DB; RPCs emit camelCase JSON (`json_build_object`) matching frontend zod schemas exactly.
- All RPCs `SECURITY DEFINER` with explicit `auth.uid()` / claim checks inside; `search_path` pinned. Tables deny-by-default; RLS policies per role.
- JWT claims `role` + `company_id` injected by a **Custom Access Token Hook** reading `profiles`.
- Money `int`, time `timestamptz` UTC, IDs `uuid`, gender enum `('male','female')`.
- Secrets (QR HMAC) in **Supabase Vault**; read via `vault.decrypted_secrets` inside RPCs only.

## 3. Milestones

### M0 — Project & platform (days, not a week)
- [ ] Supabase project (hosted) + `supabase init`, local stack via `supabase start`.
- [ ] Auth config: **anonymous sign-in enabled** (passengers) + email/password (operators/admins, signups disabled — admin-created only). No OTP/SMS provider anywhere in v1.
- [ ] CI: `supabase db reset` (applies all migrations + seed) → vitest RPC tests → `gen types --check` (committed types are fresh).
- [ ] Custom Access Token Hook + `profiles` table (operator/admin only) + role policies scaffold.
**DoD:** fresh clone → `supabase start` → seeded DB, CI green.

### M1 — Schema, RLS, seed (BACKEND_V1 §8)
- [ ] All tables + enums (incl. `gender`) + indexes + CHECK constraints.
- [ ] RLS: public read (cities, approved companies, published future trips) · passenger owns bookings · operator scoped by `company_id` claim · admin read-all.
- [ ] Seed per §7 — includes departed trip, full trip, mixed-gender booked seats.
**DoD:** frontend can point supabase-js at local stack and read cities/trips raw.

### M2 — Catalog RPCs + search
- [ ] `search_trips` (Syria-local date → UTC window, `availableSeats` via lateral counts, camelCase shape field-for-field), `get_trip`.
- [ ] Company suspension filters at query time (immediate effect — ADM-1 AC-1).
**DoD:** search flow works end-to-end on seeded data with mocks off (staging).

### M3 — Locking ⚠️ (highest-risk milestone — do not compress)
- [ ] `get_seat_map` — layout + status + **gender on locked/booked**. Index-backed, p95 < 50ms under 15s polling.
- [ ] `lock_seats(trip_id, seats[{seatNumber, gender}])` — advisory xact lock per trip → purge expired → conflict check → insert; `UNIQUE(trip_id, seat_number)` as final guarantee. All-or-nothing, exact conflicting seats in `details.seats`.
- [ ] `release_lock` — owner-only, idempotent.
- [ ] **Concurrency suite (merge gate):** N parallel same-seat locks → exactly 1 success; overlapping multi-seat sets → zero partial locks; expiry frees seats with no cleanup job; non-owner release → FORBIDDEN.
**DoD:** concurrency suite green in CI against real local Postgres.

### M4 — Booking + idempotency
- [ ] `create_booking` — one transaction: lock validation (`LOCK_EXPIRED`), gender-vs-lock match, insert booking + passengers (partial unique on active seats), commission snapshot, PNR (no `0 O 1 I`, retry on collision), `qrPayload` HMAC via pgcrypto + Vault, delete lock, store `response_snapshot` for idempotent replay (24h).
- [ ] **Booking limits (anti-abuse, replaces OTP friction):** max active future bookings per `auth.uid()` and per phone per trip → `BOOKING_LIMIT_REACHED`. Limits as config, not hardcoded.
- [ ] `lookup_booking(pnr, phone)` — no auth, pair must match, generic `NOT_FOUND` on miss, rate-limited (counter table or pg-based limiter) against enumeration.
- [ ] `cancel_booking` — 2h window server-enforced; `active=false` frees seats.
- [ ] `get_booking`, `bookings` mine (RLS on anonymous uid, paginated).
**DoD:** two concurrent identical `create_booking` calls → exactly one booking; expired lock → `LOCK_EXPIRED`; cancel window enforced; limits + lookup tested.

### M5 — Operator
- [ ] Trips CRUD RPCs; publish → searchable immediately; price edits never touch existing bookings (test).
- [ ] `cancel_trip` → bookings cancelled + count returned.
- [ ] `get_manifest` (incl. **gender**), `check_in` (HMAC verify in-DB, company ownership check), `check_in_by_pnr`.
- [ ] `operator_cancel_booking` — no-show mitigation; own-company only, frees seats.
- [ ] Operator email/password login flow verified end-to-end with claims (OPR-0).
- [ ] Buses CRUD; layout immutable after first published trip.
- [ ] `operator_summary` (snapshotted commission math).
- [ ] **Tenant isolation test:** operator A queries operator B's trip → zero rows / FORBIDDEN.

### M6 — Admin
- [ ] Company status + commission RPCs (0.20–0.35 CHECK); suspension instant in search.
- [ ] Cities/routes CRUD; delete-with-future-trips blocked with explanation.
- [ ] Bookings overview policies + `commissions_by_month` (grouped SQL).

### M7 — Hardening + Phase E cutover (OTP removed from v1 → v1.1)
- [ ] Anonymous-session longevity check: session persistence across visits verified (a lost session = tickets only via PNR lookup — acceptable, but don't shorten it accidentally).
- [ ] Rate limits reviewed: `lookup_booking` enumeration limiter + Supabase Auth built-ins on operator login.
- [ ] Load-check `get_seat_map` + `lock_seats` (k6, 200 concurrent viewers/trip).
- [ ] Optional: Realtime channel on lock/booking tables → frontend drops polling.
- [ ] Sit with frontend for Phase E: swap `features/*/api.ts` internals endpoint-by-endpoint; fix mismatches same-day.

## 4. Environments

| Env | How | Data |
|---|---|---|
| local | `supabase start` | seed.sql |
| staging | separate Supabase project, migrations via CI on merge to `main` | seed + QA data |
| production | separate project, migrations applied on tagged release (manual approval) | real |

- `supabase db push` never used against staging/prod — CI runs `supabase migration up` only.
- Secrets: Vault (QR HMAC) + project env (SMS/Twilio keys). Nothing in repo.
- Backups: Supabase daily backups (built-in) + weekly `pg_dump` off-platform, restore tested once before launch.
- Monitoring: Supabase dashboard + logflare/logs drain; uptime check on a trivial RPC.

## 5. Working agreement with frontend

1. `BACKEND_V1.md` + committed `types/database.ts` are the contract. Shape changes: doc PR → frontend ack → migration.
2. Envelope `error.code` values are API — adding is fine, renaming is breaking.
3. Staging live and seeded from **M2** — frontend integrates continuously (Phase E is a swap of `api.ts` internals only; components/hooks/MSW-era zod schemas stay).
4. Everything MSW simulates deterministically (seat 13 conflict, LOCK_EXPIRED) must be reproducible on staging via seed/QA data.

## 6. Timeline (indicative, 1 backend dev)

| Week | Milestone |
|---|---|
| 0 | M0 + M1 schema/RLS/seed |
| 1 | M2 catalog → **staging live, frontend integrates** |
| 1–2 | M3 locking + concurrency suite |
| 2 | M4 booking + lookup + limits |
| 2–3 | M5 operator · M6 admin |
| 3 | M7 hardening/cutover |

~3 weeks (OTP removal cut the only external dependency). Critical path unchanged: M3 → M4.
