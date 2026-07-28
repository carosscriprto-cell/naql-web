# naql-web

Intercity bus booking for Syria. Arabic-first, RTL, mobile-first.

One repo, two halves:

| Path | What |
|---|---|
| `src/` | Next.js App Router · TypeScript · Tailwind · shadcn/ui · TanStack Query · next-intl (`ar` default) |
| `supabase/` | Postgres migrations + plpgsql RPCs — all critical logic lives here, never in the client |
| `tests/db/` | vitest suites against a real database (no mocks, ever) |
| `tools/qa/`, `tools/load/` | service-role QA triggers and k6 load scripts |

**The contract is [`docs/BACKEND_V1.md`](docs/BACKEND_V1.md).** Never change a response shape
without updating it in the same commit. Conventions live in [`CLAUDE.md`](CLAUDE.md).

---

## Local workflow

```bash
npm ci
npm run dev            # http://localhost:3000
```

`.env.local` drives the frontend:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
NEXT_PUBLIC_USE_MOCKS=true      # MSW still owns the booking flow until E3
```

`NEXT_PUBLIC_USE_MOCKS` **defaults to `true` when unset** (`src/config/env.ts`), so a deploy
target missing the variable ships MSW. Set it explicitly everywhere.

Search and trip detail already read Supabase directly; the booking flow (seat map, lock,
create booking, lookup) is still MSW — see `src/mocks/handlers.ts`.

```bash
npx tsc --noEmit       # typecheck
npm run lint
npm test               # frontend unit tests (tests/unit/)
npm run build
```

### There is no local database on a dev machine

This project has **no working Docker locally**, so there is no `supabase start` stack here. The
backend runs against a **hosted DEV project** (`naql-dev`) over the REST API.

```bash
npm run db:whoami      # ALWAYS run this first — prints the linked project ref
npm run db:test        # vitest against hosted DEV (credentials from .env.test)
npm run db:types       # regenerate src/types/database.ts — commit the result
```

`npm run db:reset` is **destructive** and targets DEV. It is safe in the sense that the seed is
idempotent and DEV holds no real data, but confirm the ref with `db:whoami` first, every time.

Applying migrations needs a direct Postgres connection, which the REST API does not provide:

```bash
supabase migration up --linked      # forward-only, safe
```

If that times out, the CLI is trying `db.<ref>.supabase.co:5432`, which is **IPv6-only** on
current Supabase projects. On an IPv4-only network use the pooler instead:

```bash
supabase migration up --db-url "postgresql://postgres.<ref>:<password>@<region>.pooler.supabase.com:5432/postgres"
```

**CI is the authoritative gate**, not a green run against hosted DEV. The runner has Docker, so
`.github/workflows/ci.yml` boots a full local stack, applies every migration from zero with
`supabase db reset`, and runs the concurrency suite there.

### Backend rules that bite

- All schema/function changes go through `supabase/migrations/*.sql`
  (`supabase migration new <name>`).
- **Never edit an applied migration** — add a new one. `db:reset` must replay cleanly from zero.
- **Never write SQL in the dashboard.** A change that is not a migration file does not exist.
  (One exception: the PROD Vault secret below, which must not be committed.)
- After any schema change: `npm run db:types` and commit `src/types/database.ts`.
- `supabase/config.toml` does **not** apply to hosted projects — see the auth table below.

---

## Deploy flow

| Environment | How migrations arrive | Reset? |
|---|---|---|
| **DEV** (`naql-dev`) | `supabase db reset` (replays migrations + `seed.sql`) or `migration up` | yes, freely |
| **CI** | `supabase db reset` on a throwaway local stack per run | every run |
| **PROD** | `supabase migration up` **only**, on a tag, with manual approval | **never** |

`supabase/seed.sql` runs on `db reset` only, so it never executes against PROD. Everything it
does for DEV/CI must be done by hand once on PROD — see the pre-launch checklist.

### Dashboard auth settings (not in `config.toml`)

| Setting | Value | Why |
|---|---|---|
| Email provider | **Enabled** | operators/admins sign in with email+password (OPR-0) |
| Allow new users to sign up | **Disabled** | accounts are admin-created only |
| Confirm email | **Disabled** | seeded accounts have no inbox |
| Anonymous sign-ins | **Enabled** | passenger identity in v1 |

Disabling the Email *provider* (instead of just signup) breaks operator login with
"Email logins are disabled" — these are two separate toggles.

The **Custom Access Token Hook** must also be registered in the dashboard. It injects
`user_role` and `company_id` claims from `profiles`; RLS and every operator RPC read
`auth.jwt()->>'user_role'`. Without it, every operator call returns `FORBIDDEN`.

---

## Seeded credentials (DEV/CI only)

Created by `supabase/seed.sql`. Password for **all** of them: `Password123!`

| Account | Role | Company |
|---|---|---|
| `operator.amana@naql.dev` | operator | الأمانة |
| `operator.kadmous@naql.dev` | operator | القدموس |
| `operator.ahlia@naql.dev` | operator | الأهلية |
| `admin@naql.dev` | admin | — |
| `passenger.demo@naql.dev` | passenger | owns the seeded fully-booked trip |

`tests/db/` reads `TEST_OPERATOR_EMAIL` / `TEST_OPERATOR_PASSWORD` / `TEST_ADMIN_EMAIL` /
`TEST_ADMIN_PASSWORD` from `.env.test`; the tenant-isolation suite additionally signs in as
`operator.kadmous@naql.dev` by its fixed seeded address. **Rotate every one of these before
PROD.**

`.env.test` also holds `SUPABASE_SERVICE_ROLE_KEY`. It bypasses RLS entirely, is git-ignored,
and never appears under `src/`.

---

## QA scripts (hosted DEV)

Deterministic triggers that MSW faked, reproduced against the real DEV project with the service
role. They read `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.test`.

- **Pre-lock seat 13** (QA-B-16 — lock-conflict UX):
  ```bash
  npx tsx tools/qa/prelock-seat-13.ts [tripId] [male|female]
  ```
  Holds seat `13` on a seeded trip (default: الأمانة دمشق→حلب, `n=1`) for a year so
  `lock_seats` returns `SEAT_ALREADY_LOCKED` for it. Idempotent — re-running replaces the
  existing seat-13 lock. Undo by releasing via the app or deleting the lock row.

- **Shorten a lock** (LOCK_EXPIRED UX — no 10-minute wait):
  ```bash
  npx tsx tools/qa/shorten-lock.ts <lockId>
  npx tsx tools/qa/shorten-lock.ts --trip <tripId>          # newest lock on that trip
  npx tsx tools/qa/shorten-lock.ts --trip <tripId> --in 30  # expire in 30s instead
  ```
  Moves `expires_at` into the past (or `--in N` seconds ahead) and **keeps the lock row**, so
  `create_booking` still finds it and rejects it with `LOCK_EXPIRED` — the same state a real
  timeout produces. Hold seats in the browser first, then run it with `--trip`.

---

## Load tests (`tools/load/`)

k6 scripts for the two launch-gate performance targets (docs/V1_TEST_PLAN.md §8). Install k6,
then export the DEV credentials from `.env.test`:

```bash
export $(grep -E '^SUPABASE_(URL|ANON_KEY)=' .env.test | xargs)

k6 run tools/load/seat-map.js      # T-PERF-1 — 200 VUs, p95 < 50ms
k6 run tools/load/lock-seats.js    # T-PERF-2 — burst, p95 < 200ms, correctness holds
```

Both encode their targets as k6 `thresholds`, so a miss exits non-zero and they work as CI
gates unchanged. Useful overrides: `-e VUS=`, `-e RATE=`, `-e DURATION=`, `-e TRIP_ID=`,
`-e SEATS=`, `-e SESSIONS=`.

- `seat-map.js` checks the **envelope**, not just the HTTP status — `get_seat_map` is enveloped,
  so a `NOT_FOUND` for a mistyped trip id would otherwise look like a fast, clean run.
- `lock-seats.js` needs `auth.uid()`, so `setup()` mints anonymous sessions. **Hosted DEV caps
  anonymous sign-ins at ~30/hour/IP**, hence `SESSIONS=20` by default and one run per hour.
  Prefer the CI local stack for a full run. It asserts that every response is a well-formed §0
  envelope carrying either a `lockId` or a conflict code naming the requested seat; the
  exactly-one guarantee itself is proved deterministically by `tests/db/concurrency.test.ts`,
  which is the merge gate.

---

## Parity checklist — every QA trigger reproducible on DEV

The MSW build had deterministic triggers baked in. Each one has a real equivalent so the QA
plan runs unchanged against DEV:

| QA case | MSW trigger | On DEV |
|---|---|---|
| Lock conflict (T-LOCK-7) | seat `"13"` always conflicts | `npx tsx tools/qa/prelock-seat-13.ts` |
| `LOCK_EXPIRED` (T-PAS5-3, T-PAS6-11) | edit `LOCK_TTL_MS` | `npx tsx tools/qa/shorten-lock.ts --trip <id>` |
| `BOOKING_LIMIT_REACHED` (T-PAS6-13) | phone ending `"00"` | book `max_active_bookings_per_user` (4) future trips on one anonymous session, or lower the key in `app_config` |
| Departed trip CTA (T-PAS3-2) | fixture `n=13` | seeded trip `000000e1-…-000000000013` (yesterday) |
| Full trip CTA (T-PAS3-3) | fixture `n=14` | seeded trip `000000e1-…-000000000014`, all 48 seats booked with mixed genders |
| Cancelled ticket (§4) | seeded `CANCLD` PNR | `cancel_booking` on a real booking, then look it up by PNR |
| Draft trip hidden (T-PAS3-4) | — | seeded trip `000000e1-…-000000000015` (draft) → `NOT_FOUND` |
| Suspended company vanishes (T-ADM1-1) | — | set `companies.status='suspended'`; takes effect on the **next** `search_trips` call |

Seeded ids are stable across resets — `seed.sql` uses fixed uuids and mirrors
`src/mocks/data.ts` where they overlap, so a trip id from the mock era still resolves.

---

## Pre-launch checklist (PROD only)

PROD receives `supabase migration up` and is **never** reset, so `supabase/seed.sql` never runs
there. Everything the seed does for DEV/CI must be done by hand once:

- [ ] **Create the QR HMAC secret in Vault.** `create_booking` signs every `qrPayload` with it
      and raises a loud error if it is missing — nothing can be booked until this exists. In the
      SQL editor of the PROD project (this is the one and only exception to "never write SQL in
      the dashboard" — a secret must not be committed to a migration):
      ```sql
      select vault.create_secret(
        '<a fresh 32+ byte random string>',
        'qr_hmac_secret',
        'QR ticket HMAC key (production)'
      );
      ```
      Verify: `select name from vault.decrypted_secrets where name = 'qr_hmac_secret';`
      The name must be exactly `qr_hmac_secret`. **Do not reuse the DEV/CI value** seeded by
      `supabase/seed.sql` — it is public in this repo, and anyone holding it can forge a
      check-in QR.
- [ ] Configure the dashboard auth settings (table above — they are not in `config.toml`) and
      register the custom access token hook.
- [ ] Rotate every seeded credential; the `Password123!` accounts are DEV-only.
- [ ] Re-run the grants audit against PROD: `tests/db/security.test.ts` asserts that `anon` can
      execute exactly the nine public RPCs and nothing else.
- [ ] Execute a backup restore drill once on a scratch project; document time-to-restore.

---

## Anonymous session pool (DB tests)

`tests/db/` reuses anonymous identities instead of minting one per test, because
`signInAnonymously()` is rate-limited on the hosted DEV project (~30/hour/IP).
`pooledAnonClient(index)` caches each slot's session under
`node_modules/.cache/naql-anon-sessions.json` (gitignored) and restores it via the refresh
token — so only the **first** run mints users; later runs make zero anonymous sign-ins for
pooled slots.

- **`db:reset` invalidates the pool automatically** — it wipes `auth.users`, so the cached
  refresh tokens stop working and the pool re-mints its slots on the next run. No manual step
  needed. (`clearAnonSessionCache()` exists as a manual escape hatch.)
- Tests that assert a *brand-new* sign-in (smoke's "anonymous passenger can open a session",
  claims' anonymous case) keep the real `anonClient()` / `signInAnonymously()`.
- `lookup_booking` is separately rate-limited to `lookup_rate_limit_max` (10) attempts per PNR
  per hour, counting hits **and** misses. Suites that need a real `qrPayload` randomise their
  PNRs per run so repeated runs do not exhaust the budget.
