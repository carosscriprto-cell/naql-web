# Backend Execution Plan — naql (v1, Supabase)

**Stack (locked):** Supabase · Postgres 15 · plpgsql RPCs · RLS · Supabase Auth · Supabase CLI for migrations.
**Repo:** single repo `naql-web`. Backend in `supabase/` (migrations, seed, config) and `tests/db/` (vitest). No separate repo, no app server.
**Contract:** `docs/BACKEND_V1.md`. Any shape change = doc edit first, then a migration.
**Executable reference:** `src/mocks/handlers.ts` — the MSW handlers the frontend was built and QA'd against. They already return the BACKEND_V1 §0 envelope, so they are a field-for-field spec for M3/M4.
**Frontend consumes:** `@supabase/supabase-js` — PostgREST for reads, `rpc()` for critical writes. All error UX keys on `ApiError.code`.

---

## 0. Architecture at a glance

```
naql-web  (one repo)
├── src/                       Next.js app
│     └── lib/envelope.ts      unwrap() — shared by the MSW path and the Supabase path
├── supabase/                  migrations · seed.sql · config.toml   ← ALL backend logic
├── tests/db/                  vitest
└── tools/{qa,load}/           QA scripts · k6

runtime:
  browser ──supabase-js──┬── reads ──► PostgREST + RLS ──► Postgres
                         ├── writes ─► rpc() ───────────► plpgsql functions (ALL critical logic)
                         ├── auth ──► Supabase Auth (passengers anonymous · operators/admins email+password)
                         └── realtime (optional, Phase E5)
  Edge Functions: none in v1 (no OTP, no external providers).
```

Principles:
- **Critical logic in the DB (RPC), never in the client, never in Edge Functions.** Atomicity lives where the data lives.
- No Redis. Postgres does locks, idempotency, and rate limiting.
- Expected domain errors are **returned** in the envelope, never raised. Domain errors are HTTP 200 payloads — the frontend never branches on a status code.
- **Every schema change exists as a file in `supabase/migrations/`.** The invariant is the FILE, not the
  transport. A change that isn't a migration file does not exist.
  - **PERMITTED:** pasting the *verbatim* contents of a committed migration file into the dashboard SQL
    editor, in version order, each followed by recording its version in
    `supabase_migrations.schema_migrations`. Where outbound TCP/5432 is blackholed the CLI cannot reach
    hosted DEV at all, and this is the supported fallback — see `docs/MANUAL_MIGRATION_RUNBOOK.md`.
  - **STILL FORBIDDEN:** ad-hoc SQL authored in the editor that exists in no migration file; editing an
    already-applied migration; any DDL that CI's from-zero rebuild would not reproduce.
  - **Why the invariant matters:** PROD is built by replaying the files onto an empty project, CI rebuilds
    from zero and runs the suite against *that*, and `db reset` silently erases anything that is not a
    file. Hand-typed DDL survives until the next reset and then vanishes — usually discovered as a test
    that passes on DEV and fails in CI.

## 1. Where the database actually runs

The development machine has **no working Docker**, so there is no local stack here. Three environments, three jobs:

| | hosted DEV (`naql-dev`) | CI runner | hosted PROD |
|---|---|---|---|
| Purpose | write + iterate on migrations, run suites, frontend integration from E2 | authoritative test gate | real traffic |
| Stack | hosted | full local (`supabase start`) | hosted |
| `db reset` | yes, routinely (`--linked`) | yes, every run | **never** |
| Receives | `db reset --linked` | nothing persistent | `migration up` only |
| Exists from | now | now | before launch |

**Consequence that matters:** the concurrency suites (M3/M4) are **authoritative in CI**, where a real local Postgres runs on the runner. A green run against hosted DEV is supporting evidence, not the merge gate. Network latency to a hosted project changes race timing — it can hide a bug that CI catches, and it can produce flakes that mean nothing.

**Dashboard settings are not in `config.toml`.** Hosted projects ignore that file. Anonymous sign-ins ON and email signup OFF are set in the dashboard and documented in README. Verify them before blaming code for an `UNAUTHORIZED`.

**Guard rail:** `npm run db:whoami` prints the linked project ref. Run it before every `db:reset`.

## 2. Repository layout (backend portion)

```
naql-web/
├── supabase/
│   ├── migrations/            # numbered SQL — the real contract
│   ├── seed.sql               # idempotent seed (BACKEND_V1 §7)
│   ├── functions/             # Edge Functions (empty in v1)
│   └── config.toml            # applies to the CI local stack only
├── tests/db/                  # rls · catalog · concurrency · booking · operator · admin · security
├── tools/
│   ├── qa/                    # prelock-seat-13 · shorten-lock · booking-limit fixtures
│   └── load/                  # k6 scripts
├── src/types/database.ts      # `supabase gen types --linked` output, committed
├── vitest.db.config.ts
└── .github/workflows/ci.yml   # two jobs: web · db (path-filtered)
```

Scripts: `db:whoami` · `db:reset` · `db:test` · `db:types`.

## 3. Conventions

- snake_case in DB; RPCs emit camelCase JSON (`json_build_object`) matching the frontend zod schemas exactly.
- All RPCs `SECURITY DEFINER` with explicit `auth.uid()` / claim checks inside; `search_path` pinned. Tables deny-by-default; RLS policies per role.
- JWT claims `role` + `company_id` injected by a **Custom Access Token Hook** reading `profiles`.
- Money `int`, time `timestamptz` UTC, IDs `uuid`, gender enum `('male','female')`.
- Secrets (QR HMAC) in **Supabase Vault**; read via `vault.decrypted_secrets` inside RPCs only.
- Config values (lock TTL, cancel window, booking limits) in `app_config`, read inside RPCs — never hardcoded.
- Types generated straight into `src/types/database.ts`. No copy step.

## 4. Milestones

### M0 — Project & platform ✅ done
- [x] `supabase init`; enums + `app_config` migration; vitest harness + smoke test.
- [x] Relocated into the single repo (`supabase/`, `tests/db/`).
- [ ] **B0.6:** scripts switched to `--linked`, `helpers.ts` reads `.env.test` with no fallbacks, CI recreated with two path-filtered jobs, `db:whoami` guard added.
**DoD:** `npm run db:whoami` shows DEV → `npm run db:reset` → `npm run db:test` green (3 smoke assertions).

### M1 — Schema, RLS, seed (BACKEND_V1 §8)
- [ ] All tables + enums + indexes + CHECK constraints.
- [ ] Custom Access Token Hook + `profiles` (operator/admin only).
- [ ] RLS: public read (cities, approved companies, published future trips, bus layouts) · passenger owns bookings · operator scoped by `company_id` claim · admin read-all. No write policies on core tables.
- [ ] Seed per §7 — departed trip, full trip, mixed-gender booked seats, 1 operator per company + 1 admin. **Mirrors `src/mocks/data.ts` where they overlap.**
**DoD:** raw reads of cities/trips work from supabase-js against DEV.

### M2 — Catalog RPCs → frontend integration opens
- [ ] `search_trips` (Syria-local date → UTC window, `availableSeats` via lateral counts, camelCase field-for-field), `get_trip`.
- [ ] Company suspension filters at query time (immediate effect — ADM-1 AC-1).
- [ ] Verified against `src/features/search/schemas.ts` field-for-field.
**DoD:** frontend Task E2 unblocked; `/search` and `/trips/[id]` work against DEV with mocks off.

### M3 — Locking ⚠️ (highest-risk milestone — do not compress)
- [ ] Read the `src/mocks/handlers.ts` lock/seat-map handlers first; match them exactly or raise the divergence before writing SQL.
- [ ] `get_seat_map` — layout + status + **gender on locked/booked**. Index-backed, p95 < 50ms under 15s polling.
- [ ] `lock_seats` — advisory xact lock per trip → purge expired → conflict check → insert; `UNIQUE(trip_id, seat_number)` as the final guarantee. All-or-nothing, exact conflicting seats in `details.seats`.
- [ ] `release_lock` — owner-only, idempotent.
- [ ] **Concurrency suite:** N parallel same-seat locks → exactly 1 success; overlapping multi-seat sets → zero partial locks; expiry frees seats with no cleanup job; non-owner release → FORBIDDEN.
- [ ] `tools/qa/prelock-seat-13.ts` — makes the frontend's conflict UX reproducible.
**DoD:** concurrency suite green **5 consecutive runs in CI**. A flake is a failure, not a retry.

### M4 — Booking + idempotency
- [ ] `create_booking` — one transaction: idempotency replay, lock validation (`LOCK_EXPIRED`), gender-vs-lock match, insert booking + passengers (partial unique on active seats), commission snapshot, PNR (no `0 O 1 I`, retry on collision), `qrPayload` HMAC via pgcrypto + Vault, delete lock, store `response_snapshot` (24h replay). **`idempotency_key` is an argument, never a header.**
- [ ] **Booking limits:** max active future bookings per `auth.uid()` and per phone per trip → `BOOKING_LIMIT_REACHED`. From `app_config`.
- [ ] `lookup_booking(pnr, phone)` — no auth, pair must match, byte-identical `NOT_FOUND` on miss, rate-limited against enumeration.
- [ ] `cancel_booking` — 2h window server-enforced; `active=false` frees seats.
- [ ] `get_booking`, bookings-mine (RLS on anonymous uid, paginated).
- [ ] `tools/qa/shorten-lock.ts` — makes LOCK_EXPIRED reproducible without waiting 10 minutes.
**DoD:** two concurrent identical `create_booking` in CI → exactly one booking. Frontend Task E3 unblocked.

### M5 — Operator
- [ ] Trips CRUD; publish → searchable immediately; price edits never touch existing bookings (test).
- [ ] `cancel_trip` → bookings cancelled + count returned.
- [ ] `get_manifest` (incl. **gender**), `check_in` (HMAC verify in-DB, company ownership check), `check_in_by_pnr`.
- [ ] `operator_cancel_booking` — no-show mitigation; own-company only.
- [ ] Operator email/password login verified end-to-end with claims (OPR-0).
- [ ] Buses CRUD; layout immutable after the first published trip.
- [ ] `operator_summary` (snapshotted commission math).
- [ ] **Tenant isolation test:** operator A queries operator B's data → zero rows / FORBIDDEN. **Launch blocker.**

### M6 — Admin
- [ ] Company status + commission RPCs (0.20–0.35 CHECK); suspension instant in search.
- [ ] Cities/routes CRUD; delete-with-future-trips blocked with an explanation.
- [ ] Bookings overview policies + `commissions_by_month`.

### M7 — Hardening + production
- [ ] Grants audit as `tests/db/security.test.ts` (not a manual checklist): anon may call only the nine public RPCs.
- [ ] Anonymous-session longevity check — a lost session means tickets only via PNR lookup; acceptable, but don't shorten it accidentally.
- [ ] Rate limits reviewed: `lookup_booking` limiter + Supabase Auth built-ins on operator login.
- [ ] Load check `get_seat_map` + `lock_seats` (k6, 200 concurrent viewers/trip).
- [ ] **Create the PROD project**; apply migrations via `migration up`; set Vault secret; configure dashboard auth settings; rotate seeded credentials.
- [ ] Optional: Realtime channel on lock/booking tables → frontend drops polling (E5).
- [ ] Parity checklist: every deterministic trigger the QA plan relies on is reproducible via `tools/qa/`.

## 5. Deployment flow

```
migration written locally
        ↓
npm run db:whoami        ← confirm DEV
npm run db:reset         ← replay everything from zero on DEV
npm run db:test          ← suites against DEV
        ↓
commit + push
        ↓
CI: web job (tsc/lint/build) + db job (full local stack → reset → suites → types diff)
        ↓
merge to main
        ↓
[before launch] supabase link --project-ref <prod> && supabase migration up
```

- `supabase db push` is never used anywhere.
- `db reset` against PROD is a data-loss incident. `db:whoami` exists to prevent it.
- Backups: Supabase daily backups + a restore drill executed once before launch.

## 6. Working agreement

1. `docs/BACKEND_V1.md` + `src/types/database.ts` are the contract. Shape change: doc edit → migration → regenerate types → the compiler catches every consumer.
2. Envelope `error.code` values are API — adding is fine, renaming is breaking.
3. DEV is live and seeded from **M1** — the frontend integrates continuously from M2. Phase E swaps `features/*/api.ts` internals only; components, hooks, and zod schemas stay.
4. Everything MSW simulates deterministically (seat 13 conflict, LOCK_EXPIRED, booking limit) must be reproducible on DEV via `tools/qa/`.
5. Before M3, read `src/mocks/handlers.ts` end to end against BACKEND_V1 §3/§4. Any divergence → fix the doc first, then both sides.

## 7. Timeline (indicative, solo)

| Week | Milestone |
|---|---|
| 0 | M0 ✅ · B0.6 · M1 schema/RLS/seed |
| 1 | M2 catalog → frontend E1/E2 · frontend QA round + Task 15 in the gap |
| 1–2 | M3 locking + concurrency suite |
| 2 | M4 booking + lookup + limits → frontend E3 |
| 2–3 | M5 operator · M6 admin |
| 3 | M7 hardening + PROD project |

Critical path unchanged: **M3 → M4**.
