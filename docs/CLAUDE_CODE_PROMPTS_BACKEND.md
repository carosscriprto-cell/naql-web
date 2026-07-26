# Claude Code — Task Prompts (Backend: supabase/ inside naql-web)

**Repo:** single repo `naql-web`. Backend = `supabase/` (migrations, seed, config) + `tests/db/` (vitest). No app server, no separate repo.
**Contract:** `docs/BACKEND_V1.md` — already in this repo, no copying. Any shape change = doc PR first.
**Local stack:** Docker + Supabase CLI. `npm run db:start` boots Postgres+Auth+PostgREST locally; the hosted project is touched only from B2 onward, via `supabase migration up --linked`. **Never write SQL in the Supabase dashboard** — every change is a migration file.
**Types:** generated straight into `src/types/database.ts` (`npm run db:types`). No sync step, no copy.
**Status:** B0 done (needs the relocation step below). Next: B1.

## Commands

```bash
npm run db:start    # supabase start
npm run db:reset    # apply all migrations + seed from zero — must ALWAYS pass
npm run db:test     # vitest run -c vitest.db.config.ts
npm run db:types    # gen types → src/types/database.ts
npm run db:stop     # free the containers when working on the frontend
```

## How to use

- One task per session. Review the diff, run the task's verification, commit.
- **B3 and B4 are the riskiest code in the product** — never combine them with anything else, never skip their tests.
- After every task: `npm run db:reset` must pass from zero.

---

## Task B0.5 — Relocate B0 into the single repo (manual, no session)

B0 was executed in a separate `naql-db/` folder. Move it before B1:

```bash
cd /d/x-bus/naql-web
mv ../naql-db/supabase ./supabase
mkdir -p tests/db && mv ../naql-db/tests/* tests/db/
mv ../naql-db/vitest.config.ts ./vitest.db.config.ts
rm -rf ../naql-db          # the duplicated docs/ inside it are the real hazard
```

Then:
- `vitest.db.config.ts` → `include: ["tests/db/**/*.test.ts"]`
- `package.json` → add the five `db:*` scripts above; `vitest` in devDependencies; `@supabase/supabase-js` as a normal dependency (one version for app + tests)
- `.gitignore` → `supabase/.branches`, `supabase/.temp`, `supabase/signing_keys.json`
- `CLAUDE.md` → append the backend block below as a clearly separated section
- `.github/workflows/ci.yml` → two jobs (`web`, `db`) with `dorny/paths-filter@v3`; the `db` job runs only when `supabase/**` or `tests/db/**` changed

Verify: `npm run db:reset && npm run db:test` green from the new location.

---

## 0) CLAUDE.md — backend section (append, don't replace)

```md
# Backend rules (supabase/ + tests/db/)

Contract: docs/BACKEND_V1.md. Never change a response shape without updating the doc in the same PR.

- ALL schema/function changes via supabase/migrations/*.sql (`supabase migration new <name>`).
  Never edit an applied migration — add a new one. `npm run db:reset` must always pass.
- Never write SQL in the Supabase dashboard. The hosted project only ever receives `migration up`.
- DB is snake_case. Every RPC output is camelCase JSON built with json_build_object / json_agg —
  shapes match docs/BACKEND_V1.md field-for-field.
- Critical-write RPCs return the envelope:
    ok:   jsonb_build_object('ok', true, 'data', ...)
    fail: jsonb_build_object('ok', false, 'error', jsonb_build_object('code',..,'message',..,'details',..))
  Expected domain errors are RETURNED, never RAISEd. Codes only from BACKEND_V1 §0.
  This is the same envelope the frontend MSW handlers already return — src/mocks/handlers.ts is the
  executable reference for request/response shapes.
- All RPCs: SECURITY DEFINER, SET search_path = public, explicit auth checks inside
  (auth.uid() / auth.jwt()->>'role' / auth.jwt()->>'company_id'). Public-callable functions GRANTed to
  anon+authenticated explicitly; everything else REVOKEd.
- Tables: RLS enabled, deny-by-default. Policies per role. Writes on core tables only inside RPCs.
- Money int (SYP), time timestamptz UTC, ids uuid default gen_random_uuid(), gender enum ('male','female').
- Secrets (QR HMAC) via Supabase Vault only — never in migrations or code.
- Tests: vitest in tests/db/, against the local stack via supabase-js (anon + service role).
  Concurrency tests use Promise.all real parallel calls — no mocks.
- Config values (lock TTL, cancel window, booking limits) live in app_config, read inside RPCs.
  Never hardcode 10 / 2 / 4 literals.
```

---

## Task B1 — Schema + RLS + Access Token Hook + seed

```
Implement docs/BACKEND_V1.md §8 and docs/BACKEND_EXECUTION_PLAN.md M1.
Work in supabase/ and tests/db/ only. Do not touch src/.

1. Migration with all tables per §8: profiles, cities, companies, routes, buses, trips, seat_locks,
   seat_lock_seats, bookings, booking_passengers. Include exactly:
   - CHECK (commission_rate between 0.20 and 0.35)
   - UNIQUE(trip_id, seat_number) on seat_lock_seats
   - partial UNIQUE(trip_id, seat_number) WHERE active on booking_passengers
   - unique pnr, unique idempotency_key
   - every index listed at the end of §8
2. Custom Access Token Hook (plpgsql per Supabase docs) injecting role + company_id from profiles;
   register it in supabase/config.toml. Users without a profiles row get role 'passenger'.
3. RLS on every table. Policies:
   - public SELECT: cities, approved companies, published future trips, buses (layout needed for the seat map)
   - bookings/booking_passengers SELECT: owner (user_id = auth.uid()), operator of the trip's company, admin
   - profiles: self-read
   - everything else denied. NO INSERT/UPDATE/DELETE policies on core tables — writes go through RPCs.
4. supabase/seed.sql — idempotent (fixed uuids + ON CONFLICT DO NOTHING):
   - 6 cities: damascus, aleppo, homs, latakia, deir-ez-zor, tartus
   - 3 approved companies, routes between the cities
   - 2 buses per company, layout jsonb 12x4 with aisleAfterCol 2
   - 2 weeks of published trips + 1 departed + 1 fully-booked (booked seats with MIXED genders)
   - 1 operator account per company + 1 admin (auth.users seed-safe + profiles rows)
   Document the seeded credentials in README.
   Mirror src/mocks/data.ts where it overlaps — same layout, same trip shapes — so the frontend sees
   the same world when mocks go off.
5. tests/db/rls.test.ts: anonymous can read cities + published trips; cannot read draft trips or other
   users' bookings; cannot INSERT into trips/bookings directly.

NOT in this task: any RPC function.

Verify: npm run db:reset clean · npm run db:test green · npm run db:types then confirm
src/types/database.ts is committed and fresh (git diff empty after a second run).
```

## Task B2 — Catalog RPCs + hosted staging

```
Implement docs/BACKEND_V1.md §2.

1. Migration: search_trips(from_slug text, to_slug text, travel_date date, passengers int).
   travel_date is Syria-local → build the UTC window with (travel_date::timestamp AT TIME ZONE 'Asia/Damascus').
   Filters: status='published', departure_at > now(), company approved (evaluated at query time).
   availableSeats via LATERAL counts: bus layout capacity − active booking_passengers − unexpired
   seat_lock_seats; drop rows where availableSeats < passengers.
   Return a json array in the exact §2 camelCase shape (nested company/fromCity/toCity). GRANT anon, authenticated.
2. get_trip(trip_id uuid) — same item shape + cancellationPolicy; envelope NOT_FOUND for missing/draft/
   suspended-company trips. Departed trips ARE returned (the frontend renders the disabled state).
3. tests/db/catalog.test.ts:
   - search returns the seeded دمشق→حلب trips with correct availableSeats
   - suspending a company via service role removes its trips from the NEXT search call immediately
   - date boundary: a 23:30 Damascus-time trip lands on the correct local date
4. Read src/features/search/schemas.ts and confirm the RPC output matches those zod schemas
   field-for-field. Report any mismatch as a BACKEND_V1 doc issue — do not silently adapt either side.

Verify: npm run db:reset && npm run db:test green.

Then (manual, outside the session):
  supabase link --project-ref <ref>
  supabase migration up --linked
Staging is now live and seeded → frontend Task E2 is unblocked.
```

## Task B3 — Seat map + locking ⚠️ (highest-risk task — nothing else in this session)

```
Implement docs/BACKEND_V1.md §3 and EXECUTION_PLAN M3.

FIRST: read src/mocks/handlers.ts — the lock/seat-map handlers there are the executable spec the
frontend was built and QA'd against (request shape, envelope, details.seats contents, conflict
ordering). Match them exactly. Any deviation you believe is necessary → stop and report it before
writing the migration.

1. get_seat_map(p_trip_id uuid) — layout from the bus jsonb + per-seat status.
   gender present ONLY on locked (unexpired seat_lock_seats) and booked (active booking_passengers) seats.
   Index-backed; add any missing index. GRANT anon + authenticated.
2. lock_seats(p_trip_id uuid, p_seats jsonb) where p_seats = [{"seatNumber","gender"}].
   Requires auth.uid() (anonymous ok) else UNAUTHORIZED. One function, one transaction:
   a. perform pg_advisory_xact_lock(hashtext(p_trip_id::text))
   b. DELETE expired seat_locks for this trip (cascades seat_lock_seats)
   c. trip not published / already departed → TRIP_DEPARTED or NOT_FOUND
   d. conflicts := requested ∩ (booked ∪ locked) → SEAT_ALREADY_BOOKED or SEAT_ALREADY_LOCKED with
      details.seats = exactly the conflicting seats. Lock NOTHING.
   e. INSERT seat_locks (owner_id = auth.uid(), expires_at = now() + lock_ttl from app_config)
      + seat_lock_seats with gender
   f. return { lockId, expiresAt }
   Wrap the INSERT in EXCEPTION WHEN unique_violation → SEAT_ALREADY_LOCKED (the constraint is the
   final guarantee, not the primary check).
3. release_lock(p_lock_id uuid) — owner-only (else FORBIDDEN); idempotent (gone lock still returns ok).
4. tests/db/concurrency.test.ts — MERGE GATE:
   - 10 parallel lock_seats from 10 distinct anonymous sessions, same seat → exactly 1 ok, 9 SEAT_ALREADY_LOCKED
   - parallel overlapping sets ["5","6"] vs ["6","7"] → one ok, other conflicts on exactly ["6"],
     ZERO partial rows in seat_lock_seats
   - expiry: service-role UPDATE expires_at to the past → seat available in get_seat_map and lockable
     again, with no cleanup job
   - release by non-owner → FORBIDDEN; by owner → seat freed
   - a gender declared in a lock appears in get_seat_map for a different session
5. tools/qa/prelock-seat-13.ts — a service-role script that pre-locks seat 13 on a seeded trip, so the
   frontend's conflict UX (QA case QA-B-16) is reproducible on staging. Document it in README.

Verify: npm run db:test green 5 CONSECUTIVE RUNS. Any flake = failure, not "retry".
```

## Task B4 — Booking + idempotency + lookup + limits

```
Implement docs/BACKEND_V1.md §4 and EXECUTION_PLAN M4.
FIRST: read the POST /api/bookings handler in src/mocks/handlers.ts — same spec role as B3.
Note idempotency travels in the ARGUMENTS (p_idempotency_key), never a header.

1. create_booking(p_lock_id uuid, p_idempotency_key uuid, p_payment_method text, p_passengers jsonb)
   — one transaction:
   a. idempotency first: existing booking with this key → payload hash matches → return
      response_snapshot; else IDEMPOTENCY_CONFLICT
   b. lock exists + owner = auth.uid() + unexpired → else LOCK_EXPIRED (a missing lock is also LOCK_EXPIRED)
   c. passengers exactly cover the lock's seats; each gender matches the lock's declared gender;
      phone matches ^\+9639\d{8}$ → else VALIDATION_ERROR with field details
   d. limits from app_config: active future bookings per auth.uid() and per passenger phone on this trip
      → BOOKING_LIMIT_REACHED
   e. INSERT booking (commission_rate snapshotted from company, total_price = trip.price × seat count,
      payload hash, pnr from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 with retry loop on unique_violation)
      + booking_passengers (active = true)
   f. qrPayload = bookingId || '.' || encode(hmac(bookingId::text || trip_id::text, <vault secret>,
      'sha256'), 'hex'), secret read from vault.decrypted_secrets. Document the vault setup in README.
   g. DELETE the lock; store the full response json in response_snapshot; return it
2. cancel_booking(p_booking_id uuid) — owner-only; departure_at − now() > cancel_window from app_config
   else CANCEL_WINDOW_CLOSED; status='cancelled', passengers active=false.
3. lookup_booking(p_pnr text, p_phone text) — no auth; the pair must match a booking passenger;
   miss → NOT_FOUND, byte-identical whichever field is wrong. Rate limit via a lookup_attempts table
   keyed by pnr, max 10/hour → NOT_FOUND beyond it.
4. get_booking(p_id uuid) + bookings-mine via RLS (paginated, newest first).
5. tests/db/booking.test.ts:
   - two PARALLEL identical create_booking calls → exactly one booking row, both callers get the same response
   - same key + different body → IDEMPOTENCY_CONFLICT
   - expired lock → LOCK_EXPIRED; gender mismatch vs lock → VALIDATION_ERROR
   - seats show booked (with gender) in get_seat_map after booking; freed after cancel
   - 5th active booking for the same anonymous user → BOOKING_LIMIT_REACHED
   - lookup: correct pair ok; wrong phone → NOT_FOUND; 200 generated pnrs contain no 0/O/1/I
6. tools/qa/shorten-lock.ts — service-role script forcing a lock to expire, so the frontend's
   LOCK_EXPIRED flow is reproducible on staging without waiting 10 minutes.

Verify: npm run db:reset clean · npm run db:test green 3 consecutive runs.
```

## Task B5 — Operator RPCs

```
Implement docs/BACKEND_V1.md §5 and EXECUTION_PLAN M5.
Every function: role='operator' claim required, company scope from the company_id claim.

1. Trips: create_trip (draft), update_trip (price/times/status; publish → immediately searchable),
   cancel_trip (all bookings → cancelled, passengers active=false, return affected count).
   A price change must NOT touch existing bookings' total_price (test it).
2. get_manifest(trip_id) → [{ seatNumber, fullName, gender, phone, paymentStatus, checkedInAt }] —
   own-company trips only, else NOT_FOUND.
3. check_in(qr_payload): split on '.', recompute the HMAC, verify the booking's trip belongs to this
   company. Invalid signature or other company → NOT_FOUND with reason; already checked in → envelope
   error with checkedInAt in details; success sets checked_in_at and returns { booking, passenger }.
   check_in_by_pnr(pnr) follows the same rules.
4. operator_cancel_booking(booking_id) — own-company only; frees seats; no time-window restriction
   (this is the no-show mitigation for guest bookings).
5. Buses: create_bus / update_bus — layout immutable once the bus has any published trip
   (envelope error with an explanation).
6. operator_summary(from_date, to_date) → { bookings, revenue, commission, net, occupancyRate }
   using the SNAPSHOTTED commission_rate per booking, in a single grouped query.
7. tests/db/operator.test.ts including the TENANT ISOLATION GATE: operator A calling get_manifest /
   update_trip / operator_cancel_booking / trips select on operator B's data → NOT_FOUND / FORBIDDEN /
   zero rows on every path. Check-in: valid QR ok, tampered HMAC rejected, other-company booking rejected.

Verify: tenant isolation tests green — OPR-1 AC-3 is a launch blocker.
```

## Task B6 — Admin RPCs

```
Implement docs/BACKEND_V1.md §6. role='admin' required on every function.

1. Companies: create_company, set_company_status (pending|approved|suspended), set_commission_rate
   (the CHECK enforces 0.20–0.35 → surface as VALIDATION_ERROR, never a raw exception).
   Suspension already vanishes from search via B2's query-time filter — add a regression test here.
2. Cities/routes: create/update; delete blocked with an explanation when future published trips exist.
3. Admin read policies: bookings overview filterable by company/date (RLS admin-read-all from B1 — verify).
4. commissions_by_month(month date) → per-company { company, bookings, gross, commission },
   grouped SQL over snapshotted rates.
5. tests/db/admin.test.ts: non-admin → FORBIDDEN on all of them; commission snapshot regression
   (change a company's rate → old bookings' math unchanged in both operator_summary and commissions_by_month).

Verify: green + npm run db:reset clean.
```

## Task B7 — Hardening + Phase E handoff

```
1. Grants audit: enumerate all functions; anon may call ONLY search_trips, get_trip, get_seat_map,
   lock_seats, release_lock, create_booking, cancel_booking, lookup_booking, get_booking.
   Everything else authenticated + role-checked. REVOKE defaults explicitly (PUBLIC execute).
   Write it as tests/db/security.test.ts, not a manual checklist.
2. Performance: EXPLAIN ANALYZE get_seat_map and search_trips on seeded data; add missing indexes.
   k6 script in tools/load/ for get_seat_map + lock_seats (200 VUs); documented target p95 < 50ms
   for the seat map.
3. Config sanity: grep migrations for hardcoded 10 / 2 / 4 literals — all TTL/window/limit values
   must come from app_config.
4. README final: local workflow, staging/prod deploy flow (migration up via CI on main; prod on tag
   with manual approval), Vault secret setup, seeded credentials, and the tools/qa scripts.
5. Parity checklist vs the frontend: every deterministic trigger the QA plan relies on is reproducible
   on staging — seat 13 pre-lock, shortened lock (LOCK_EXPIRED), BOOKING_LIMIT demo data.

Also assert that anon and authenticated hold NO direct table privileges beyond what RLS policies
require, and that the service_role grants migration did not leak privileges to either role.

Verify: full suite green 3 consecutive runs; fresh clone → npm ci → npm run db:start → db:reset →
db:test green with nothing else needed.
```

---

## Prompting rules

1. One task per session; **B3 and B4 strictly alone**.
2. Reference docs by path — the agent reads them itself. Never paste contracts into prompts.
3. State what NOT to build.
4. CLAUDE.md carries the conventions so prompts never repeat the envelope / SECURITY DEFINER / migration rules.
5. Wrong output → revert, tighten, rerun. **Never patch a bad migration — replace it before it's committed.**

## Sequencing vs the frontend

```
B0 ✓ → B0.5 (relocate) → B1 → B2 ──► link hosted staging ──► frontend E1 + E2 unblocked
                                 │
                     [QA round + Task 15 fit naturally here — nothing blocks them]
                                 │
                            B3 → B4 ──────────────────────► frontend E3 unblocked
                                 │
                            B5 → B6 ──────────────────────► Phase D builds on real RPCs (no MSW)
                                 │
                                B7
```

- After **B2**: point the frontend at staging with mocks off for search only.
- Before **B3**: read `src/mocks/handlers.ts` end to end against `docs/BACKEND_V1.md` §3/§4.
  Any divergence → fix the doc first, then both sides. That half hour saves days in Phase E.
- After **B4**: frontend Task E3 is unblocked. Task 15 must already be done by then.