# Claude Code — Task Prompts (Backend: naql-db, Supabase)

**Repo:** `naql-db` — migrations + RPCs + RLS + seed + tests. No app server.
**Contract:** `docs/BACKEND_V1.md` (copy it + `docs/USER_STORIES.md` into this repo's `docs/`). Any shape change = doc PR first.
**Tooling assumed installed:** Supabase CLI, Docker (for `supabase start`), Node 20 (vitest tests).

## How to use

- Run tasks **in order**, one per session. Review the diff, run the task's verification, commit.
- B3 and B4 are the riskiest code in the product — never combine them with anything else, never skip their tests.
- After every task: `supabase db reset` must pass (all migrations + seed replay cleanly from zero).

---

## 0) CLAUDE.md (put at repo root — copy as-is)

```md
# Project: naql-db — Supabase backend for intercity bus booking (Syria).

Contract: docs/BACKEND_V1.md. Never change a response shape without updating the doc in the same PR.

Rules:
- ALL schema/function changes via supabase/migrations/*.sql (supabase migration new <name>). Never edit an applied migration — add a new one. `supabase db reset` must always pass.
- DB is snake_case. Every RPC output is camelCase JSON built with json_build_object / json_agg — shapes match docs/BACKEND_V1.md field-for-field.
- Critical-write RPCs return the envelope:
  ok:   jsonb_build_object('ok', true, 'data', ...)
  fail: jsonb_build_object('ok', false, 'error', jsonb_build_object('code', ..., 'message', ..., 'details', ...))
  Expected domain errors are RETURNED, never RAISEd. Codes only from the fixed list in BACKEND_V1 §0.
- All RPCs: SECURITY DEFINER, SET search_path = public, explicit auth checks inside
  (auth.uid() / auth.jwt()->>'role' / auth.jwt()->>'company_id'). Public-callable functions GRANTed to anon+authenticated explicitly; everything else REVOKEd.
- Tables: RLS enabled, deny-by-default. Policies per role. Writes on core tables happen only inside RPCs.
- Money int (SYP), time timestamptz UTC, ids uuid default gen_random_uuid(), gender enum ('male','female').
- Secrets (QR HMAC) via Supabase Vault only — never in migrations or code.
- Tests: vitest in tests/, run against `supabase start` local stack using supabase-js with anon key + service role where needed. Concurrency tests use Promise.all real parallel calls — no mocks.
- Config values (lock TTL 10min, cancel window 2h, booking limits) live in a `app_config` table, read inside RPCs — not hardcoded literals.
```

---

## Task B0 — Project skeleton + CI

```
Initialize the repo per docs/BACKEND_EXECUTION_PLAN.md M0.

1. `supabase init`. Enable in supabase/config.toml: anonymous sign-ins ON, email signup DISABLED (operator/admin accounts are admin-created), no phone/SMS provider anywhere.
2. tests/ setup: vitest + @supabase/supabase-js. tests/helpers.ts exporting: anonClient() (fresh anonymous session per call), serviceClient() (service role), resetDb() note (CI uses supabase db reset). vitest.config.ts with sequential test files (concurrency tests control their own parallelism internally).
3. First migration: `app_config(key text pk, value jsonb)` seeded with lock_ttl_minutes=10, cancel_window_hours=2, max_active_bookings_per_user=4, max_active_bookings_per_phone_per_trip=4. Plus enums: gender ('male','female'), trip_status ('draft','published','cancelled'), booking_status ('confirmed','cancelled'), company_status ('pending','approved','suspended').
4. .github/workflows/ci.yml: supabase start → supabase db reset → vitest run → supabase gen types typescript --local > types/database.ts && git diff --exit-code types/ (committed types must be fresh).
5. README: prerequisites, `supabase start`, test command, migration workflow.

Not in this task: any domain table.
Verify: `supabase start` + `supabase db reset` clean, one smoke test (anonClient can connect) green.
```

## Task B1 — Schema + RLS + Access Token Hook + seed

```
Implement docs/BACKEND_V1.md §8 and docs/BACKEND_EXECUTION_PLAN.md M1.

1. Migration with all tables: profiles, cities, companies, routes, buses, trips, seat_locks, seat_lock_seats, bookings, booking_passengers — exactly per §8 incl. CHECK (commission_rate between 0.20 and 0.35), UNIQUE(trip_id, seat_number) on seat_lock_seats, partial UNIQUE(trip_id, seat_number) WHERE active on booking_passengers, unique pnr, unique idempotency_key, and all §8 indexes.
2. Custom Access Token Hook (plpgsql function per Supabase docs) injecting role + company_id claims from profiles; register it in config.toml. Users without a profiles row get role 'passenger'.
3. RLS: enable on every table. Policies: public SELECT on cities, approved companies, published future trips, buses layout (needed for seat map); bookings/booking_passengers SELECT for owner (user_id = auth.uid()), operator of the trip's company, admin; profiles self-read; everything else denied. No INSERT/UPDATE/DELETE policies on core tables (writes go through RPCs).
4. supabase/seed.sql — idempotent (ON CONFLICT DO NOTHING / fixed uuids): 6 cities (slugs: damascus, aleppo, homs, latakia, deir-ez-zor, tartus), 3 companies (approved), routes, 2 buses/company (12x4 layout jsonb, aisleAfterCol 2), 2 weeks of published trips + 1 departed + 1 fully-booked (booked seats with mixed genders), 1 operator account per company + 1 admin (auth.users via seed-safe approach + profiles rows; document credentials in README).
5. tests/rls.test.ts: anonymous can read cities/published trips; cannot read draft trips, other users' bookings; cannot INSERT into trips/bookings directly.

Verify: db reset clean; RLS tests green; gen types diff clean.
```

## Task B2 — Catalog RPCs (search_trips, get_trip)

```
Implement docs/BACKEND_V1.md §2.

1. Migration: `search_trips(from_slug text, to_slug text, travel_date date, passengers int)` — travel_date is Syria-local; build the UTC window with (travel_date::timestamp AT TIME ZONE 'Asia/Damascus'). Filters: status='published', departure_at > now(), company approved (at query time). availableSeats via LATERAL counts: capacity from bus layout jsonb minus active booking_passengers minus unexpired seat_lock_seats, minus filter availableSeats >= passengers. Returns json array in the exact §2 camelCase shape (nested company/fromCity/toCity objects). GRANT to anon, authenticated.
2. `get_trip(trip_id uuid)` — same item shape + cancellationPolicy text; envelope with NOT_FOUND for missing/draft/suspended-company trips. Departed trips ARE returned (frontend renders the disabled state).
3. tests/catalog.test.ts: search returns seeded دمشق→حلب trips with correct availableSeats; suspending a company (service role update) removes its trips from the next search call immediately; date boundary test (a 23:30 Damascus-time trip lands on the right local date).

Verify: shapes match the frontend zod schemas in naql-web src/features/search/schemas.ts field-for-field (read that file).
```

## Task B3 — Seat map + locking ⚠️ (highest-risk task — nothing else in this session)

```
Implement docs/BACKEND_V1.md §3 and EXECUTION_PLAN M3.

1. `get_seat_map(p_trip_id uuid)` — layout from bus jsonb + per-seat status; gender present ONLY on locked/booked seats (locked = unexpired seat_lock_seats, booked = active booking_passengers). Index-backed; add any missing index. GRANT anon+authenticated.
2. `lock_seats(p_trip_id uuid, p_seats jsonb)` — p_seats = [{"seatNumber","gender"}]. Requires auth.uid() (anonymous ok) else UNAUTHORIZED. Algorithm, in one function/transaction:
   a. perform pg_advisory_xact_lock(hashtext(p_trip_id::text))
   b. DELETE expired seat_locks for this trip (cascade seat_lock_seats)
   c. reject if trip not published/departed → TRIP_DEPARTED / NOT_FOUND
   d. conflicts := requested ∩ (booked ∪ locked); any → envelope SEAT_ALREADY_BOOKED or SEAT_ALREADY_LOCKED with details.seats = exactly those seats, lock NOTHING
   e. INSERT seat_locks (owner_id = auth.uid(), expires_at = now() + lock_ttl from app_config) + seat_lock_seats with gender
   f. return { lockId, expiresAt }
   Wrap the INSERT in an EXCEPTION WHEN unique_violation handler → SEAT_ALREADY_LOCKED (the constraint is the final guarantee).
3. `release_lock(p_lock_id uuid)` — owner-only (else FORBIDDEN); idempotent: gone lock still returns ok.
4. tests/concurrency.test.ts (merge gate):
   - 10 parallel lock_seats (10 distinct anonymous sessions), same seat → exactly 1 ok, 9 SEAT_ALREADY_LOCKED
   - overlapping sets ["5","6"] vs ["6","7"] in parallel → one ok, other conflicts on exactly ["6"], zero partial rows in seat_lock_seats
   - expiry: service-role UPDATE expires_at to past → seat available in get_seat_map and lockable again, no cleanup job
   - release by non-owner → FORBIDDEN; by owner → seat free
   - gender declared in a lock appears in get_seat_map for a different session

Verify: concurrency suite green 5 consecutive runs (flakiness = failure).
```

## Task B4 — Booking + idempotency + lookup + limits

```
Implement docs/BACKEND_V1.md §4 and EXECUTION_PLAN M4.

1. `create_booking(p_lock_id uuid, p_idempotency_key uuid, p_payment_method text, p_passengers jsonb)` — one transaction:
   a. idempotency first: existing booking with this key → if stored payload hash matches, return response_snapshot; else IDEMPOTENCY_CONFLICT
   b. lock exists + owner = auth.uid() + unexpired → else LOCK_EXPIRED (missing lock also LOCK_EXPIRED)
   c. passengers exactly cover the lock's seats; each gender matches the lock's declared gender; phone regex ^\+9639\d{8}$ → else VALIDATION_ERROR with field details
   d. booking limits from app_config: active future bookings per auth.uid() and per passenger phone on this trip → BOOKING_LIMIT_REACHED
   e. INSERT booking (snapshot commission_rate from company, total_price = trip.price * seat count, payload hash, pnr: 6 chars from ABCDEFGHJKLMNPQRSTUVWXYZ23456789 with retry loop on unique_violation) + booking_passengers (active=true)
   f. qrPayload = bookingId || '.' || encode(hmac(bookingId::text || trip_id::text, (vault secret), 'sha256'), 'hex') — read secret from vault.decrypted_secrets; document `supabase secrets` setup in README
   g. DELETE the lock; store full response json in response_snapshot; return it
2. `cancel_booking(p_booking_id uuid)` — owner-only; departure_at - now() > cancel_window from app_config else CANCEL_WINDOW_CLOSED; status='cancelled', passengers active=false.
3. `lookup_booking(p_pnr text, p_phone text)` — no auth; pair must match a booking passenger; miss → NOT_FOUND (identical response whichever field is wrong). Rate limit: lookup_attempts table keyed by pnr, max 10/hour → NOT_FOUND beyond it.
4. tests/booking.test.ts:
   - two PARALLEL identical create_booking calls → exactly one booking row, both callers get the same response
   - same key + different body → IDEMPOTENCY_CONFLICT
   - expired lock → LOCK_EXPIRED; gender mismatch vs lock → VALIDATION_ERROR
   - seats show booked (with gender) in get_seat_map after booking; freed after cancel
   - 5th active booking for same anonymous user → BOOKING_LIMIT_REACHED
   - lookup: correct pair ok; wrong phone → NOT_FOUND; pnr excludes 0/O/1/I

Verify: full green + db reset clean.
```

## Task B5 — Operator RPCs

```
Implement docs/BACKEND_V1.md §5 and EXECUTION_PLAN M5. Every function: role='operator' claim required, company scope from company_id claim.

1. Trips: create_trip (draft), update_trip (price/times/status; publish → immediately searchable), cancel_trip (all bookings → cancelled, passengers active=false, return affected count). Price change must not touch existing bookings' total_price (test).
2. get_manifest(trip_id) → [{ seatNumber, fullName, gender, phone, paymentStatus, checkedInAt }] — own-company trips only, else NOT_FOUND.
3. check_in(qr_payload): split on '.', recompute HMAC, verify booking's trip belongs to this company; invalid signature/other company → NOT_FOUND with reason, already checked in → envelope error with checkedInAt in details; success sets checked_in_at + returns { booking, passenger }. check_in_by_pnr(pnr) same rules.
4. operator_cancel_booking(booking_id) — own-company only; frees seats (no-show mitigation, no time-window restriction).
5. Buses: create_bus / update_bus — layout immutable once the bus has any published trip (envelope error with explanation).
6. operator_summary(from_date, to_date) → { bookings, revenue, commission, net, occupancyRate } using SNAPSHOTTED commission_rate per booking, single grouped query.
7. tests/operator.test.ts incl. the tenant-isolation gate: operator A calling get_manifest / update_trip / operator_cancel_booking on operator B's data → NOT_FOUND/FORBIDDEN, zero leakage. Check-in: valid QR ok, tampered HMAC rejected, other-company booking rejected.

Verify: tenant isolation tests green — this is OPR-1 AC-3, a launch blocker.
```

## Task B6 — Admin RPCs

```
Implement docs/BACKEND_V1.md §6. role='admin' required.

1. Companies: create_company, set_company_status (pending|approved|suspended), set_commission_rate (CHECK already enforces 0.20–0.35 → surface as VALIDATION_ERROR). Suspension already vanishes from search (B2 filters at query time — add regression test here).
2. Cities/routes: create/update; delete blocked with explanation when future published trips exist.
3. Admin read policies: bookings overview filterable by company/date (RLS admin-read-all from B1 — verify).
4. commissions_by_month(month date) → per-company { company, bookings, gross, commission } — grouped SQL over snapshotted rates.
5. tests/admin.test.ts: non-admin → FORBIDDEN on all; commission snapshot regression (change company rate → old bookings' commission math unchanged in both operator_summary and commissions_by_month).

Verify: green + db reset clean.
```

## Task B7 — Hardening + Phase E handoff

```
1. Grants audit: list all functions; anon may call ONLY search_trips, get_trip, get_seat_map, lock_seats, release_lock, create_booking, cancel_booking, lookup_booking, get_booking. Everything else authenticated + role-checked. REVOKE defaults explicitly (PUBLIC execute).
2. Performance: EXPLAIN ANALYZE get_seat_map and search_trips on seeded data; add missing indexes; k6 script in tools/load/ for get_seat_map + lock_seats (200 VUs), documented target p95 < 50ms for the seat map.
3. Config sanity: all TTL/window/limit values read from app_config (grep for hardcoded 10/2/4 literals).
4. README final: staging/prod deploy flow (supabase link + migration up via CI on main; prod on tag with manual approval), Vault secret setup, seed credentials, type-sync step for naql-web (copy types/database.ts).
5. Parity checklist vs frontend MSW: seat "13" behavior note (real staging: pre-lock seat 13 via a QA script in tools/qa/), LOCK_EXPIRED reproducible (QA script shortening a lock), BOOKING_LIMIT demo data.

Verify: full test suite green 3 consecutive runs; fresh clone → supabase start → db reset → tests green, nothing else needed.
```

---

## Prompting rules (same as frontend)

1. One task per session; B3/B4 strictly alone.
2. Reference docs by path — the agent reads them itself.
3. State what NOT to build (e.g. "no domain tables" in B0).
4. CLAUDE.md carries conventions (envelope, SECURITY DEFINER, migrations discipline) so prompts never repeat them.
5. Wrong output → revert, tighten prompt, rerun. Never patch a bad migration — replace it before it's committed.

## Sequencing vs frontend

- After **B2**: point naql-web at the local/staging stack with mocks off → search flow integration starts (frontend can be mid-Phase-B, no conflict).
- After **B4**: frontend Task E3 (booking swap) is unblocked.
- After **B5/B6**: Phase D operator/admin screens build against real RPCs directly (no MSW needed for Phase D).
```
