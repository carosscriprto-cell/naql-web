# STATE REPORT — naql-web

Read-only audit. Nothing was modified; no migrations created; no `db:reset` / `db:start` run.
Baseline: `docs/BACKEND_V1.md` (contract) + `CLAUDE.md` (rules). HEAD = `1d065b5` "feat: B4 — booking, idempotency, lookup, limits".

**Working tree is dirty.** Uncommitted at audit time:

| path | state |
|---|---|
| `supabase/migrations/20260727130000_create_booking_lock_single_snapshot.sql` | untracked |
| `src/lib/rpc.ts`, `src/lib/supabase/` | untracked (E1) |
| `tests/db/envelope.test.ts`, `tests/unit/`, `vitest.config.ts` | untracked |
| `src/features/search/api.ts`, `src/mocks/handlers.ts` | modified (E2) |
| `docs/BACKEND_V1.md`, `src/lib/envelope.ts`, `src/lib/api-error.ts`, `tests/db/booking.test.ts` | modified |
| `package.json`, `package-lock.json`, `eslint.config.mjs` | modified |

---

## 1. MIGRATIONS

| filename | creates / alters |
|---|---|
| `20260725141239_init_config_and_enums.sql` | enums `gender`, `trip_status`, `booking_status`, `company_status`; table `app_config` + 4 seeded keys; RLS on `app_config` with no policies |
| `20260725202100_schema_rls_hook.sql` | 10 domain tables (`profiles`…`booking_passengers`), 7 indexes + partial unique `booking_passengers_active_seat_uq`, `custom_access_token_hook`, RLS enable + 13 SELECT policies, anon/authenticated grants |
| `20260726100000_service_role_grants.sql` | `grant all` on all tables/sequences/functions in `public` to `service_role` + matching default privileges |
| `20260726125327_catalog_rpcs.sql` | `search_trips` (bare array), `get_trip` (envelope) + grants |
| `20260726135700_seat_map_and_locking.sql` | `get_seat_map` (bare), `lock_seats`, `release_lock` + grants |
| `20260726141549_get_seat_map_envelope.sql` | replaces `get_seat_map` → envelope; body otherwise identical |
| `20260727120000_booking_rpcs.sql` | `bookings.payload_hash`; table `lookup_attempts` + index; 2 `app_config` keys; `supabase_vault` ext; `qr_hmac_secret`, `generate_pnr`, `booking_ticket`, `create_booking`, `cancel_booking`, `get_booking`, `lookup_booking` |
| `20260727130000_create_booking_lock_single_snapshot.sql` | replaces `create_booking` — lock row + its seat array read in ONE statement (READ COMMITTED race fix) |

**Edited-after-applied check** (`git log` per file):

- No migration shows more than one commit. Every replacement of an existing function was done in a **new** migration (6 replaces 5, 8 replaces 7) — the CLAUDE.md rule is intact.
- ⚠ `20260727130000_create_booking_lock_single_snapshot.sql` shows **0 commits — it is untracked**. It has presumably been applied to DEV but does not exist in git history. Anyone cloning the repo gets a different `create_booking`.

---

## 2. RPC INVENTORY

| name | arguments | returns | GRANT execute | SEC DEFINER | search_path pinned |
|---|---|---|---|---|---|
| `custom_access_token_hook` | `event jsonb` | bare (auth hook event) | `supabase_auth_admin` only; revoked from public/anon/authenticated | **no** (invoker, by design) | yes |
| `search_trips` | `p_from_slug text, p_to_slug text, p_travel_date date, p_passengers int` | **bare** jsonb array | anon, authenticated | yes | yes |
| `get_trip` | `p_trip_id uuid` | **envelope** | anon, authenticated | yes | yes |
| `get_seat_map` | `p_trip_id uuid` | **envelope** (since mig 6) | anon, authenticated | yes | yes |
| `lock_seats` | `p_trip_id uuid, p_seats jsonb` | **envelope** | anon, authenticated | yes | yes |
| `release_lock` | `p_lock_id uuid` | **envelope** | anon, authenticated | yes | yes |
| `qr_hmac_secret` | none | bare text | revoked from public/anon/authenticated (internal) | yes | yes |
| `generate_pnr` | none | bare text | revoked from public/anon/authenticated (internal) | **no** | yes |
| `booking_ticket` | `p_booking_id uuid` | bare jsonb (internal helper) | revoked from public/anon/authenticated | yes | yes |
| `create_booking` | `p_lock_id uuid, p_idempotency_key uuid, p_payment_method text, p_passengers jsonb` | **envelope** | anon, authenticated | yes | yes |
| `cancel_booking` | `p_booking_id uuid` | **envelope** | anon, authenticated | yes | yes |
| `get_booking` | `p_id uuid` | **envelope** | anon, authenticated | yes | yes |
| `lookup_booking` | `p_pnr text, p_phone text` | **envelope** | anon, authenticated | yes | yes |

Notes:

- `service_role` additionally holds EXECUTE on **every** function above via `alter default privileges` (mig 3). `revoke … from public` does not touch that explicit grant, so `service_role` can call `qr_hmac_secret()`. Not a new exposure (service_role reads Vault directly anyway), but it means the "internal" three are internal to *clients*, not to the service key.
- No operator/admin RPCs exist yet (`create_trip`, `cancel_trip`, `get_manifest`, `check_in`, `operator_summary`, `set_company_status`, `commissions_by_month`, …). BACKEND_V1 §5/§6 are entirely unimplemented.

### Error codes returned in migrations

| code | returned by | in §0 enum |
|---|---|---|
| `VALIDATION_ERROR` | `lock_seats`, `create_booking` | yes |
| `UNAUTHORIZED` | `lock_seats`, `cancel_booking`, `get_booking` | yes |
| `FORBIDDEN` | `release_lock` | yes |
| `NOT_FOUND` | `get_trip`, `get_seat_map`, `lock_seats`, `cancel_booking`, `get_booking`, `lookup_booking` | yes |
| `SEAT_ALREADY_LOCKED` | `lock_seats` (conflict check + `unique_violation` handler) | yes |
| `SEAT_ALREADY_BOOKED` | `lock_seats`, `create_booking` | yes |
| `LOCK_EXPIRED` | `create_booking` | yes |
| `TRIP_DEPARTED` | `lock_seats`, `create_booking` | yes |
| `IDEMPOTENCY_CONFLICT` | `create_booking` | yes |
| `CANCEL_WINDOW_CLOSED` | `cancel_booking` | yes |
| `BOOKING_LIMIT_REACHED` | `create_booking` (per-user + per-phone) | yes |

**Zero out-of-enum codes in the migrations.** All 11 §0 codes are used.

Two deliberate non-envelope failures (RAISE, not RETURN): missing Vault secret in `qr_hmac_secret` (`internal_error`), and `PNR generation failed after % attempts` in `create_booking`.

Out of scope for the above but worth recording: the **frontend** mints `NETWORK_ERROR` in `src/lib/rpc.ts` and `src/features/search/api.ts`. It is not in the §0 enum, deliberately (documented in `rpc.ts:23-28` — "no answer", not "the answer was no").

---

## 3. LOCKING + BOOKING INTEGRITY

**a. `seat_lock_seats.lock_id` ON DELETE CASCADE from `seat_locks`? — YES**

```sql
lock_id uuid not null references public.seat_locks (id) on delete cascade
```
`20260725202100_schema_rls_hook.sql:87`

**b. Does `create_booking` read the lock with `FOR UPDATE`? — NO**

```sql
select sl.id, sl.trip_id, sl.owner_id, sl.expires_at,
       array_agg(s.seat_number order by s.seat_number)
         filter (where s.seat_number is not null) as seat_numbers
into v_lock
from seat_locks sl
left join seat_lock_seats s on s.lock_id = sl.id
where sl.id = p_lock_id
group by sl.id, sl.trip_id, sl.owner_id, sl.expires_at;
```
`20260727130000_create_booking_lock_single_snapshot.sql:134-141` — no locking clause anywhere in the function.

Serialization instead comes from `perform pg_advisory_xact_lock(hashtext('create_booking:' || p_idempotency_key::text)::bigint)` (line 90), which keys on the **idempotency key, not the lock_id or trip_id**. Two callers with *different* idempotency keys racing the *same* lock are not serialized here; they are caught downstream by `delete from seat_locks` + the partial unique index `booking_passengers_active_seat_uq` → `SEAT_ALREADY_BOOKED`. That path is covered by `booking.test.ts:244`.

**c. Conditions returning `LOCK_EXPIRED` in `create_booking`, in evaluation order:**

1. `not found` — no `seat_locks` row for `p_lock_id` (line 143)
2. `v_lock.owner_id is distinct from v_uid` — foreign lock (line 144)
3. `v_lock.expires_at <= now()` — expired (line 145)
4. `v_lock.seat_numbers is null or array_length(v_lock.seat_numbers, 1) is null` — live lock with an empty seat set, i.e. consumed concurrently (lines 156-158)

All four return the same `v_lock_expired` constant (line 60). Conditions 1-3 are one `if`; condition 4 is the defensive invariant this migration added.

**d. Does the idempotency replay run BEFORE the lock read? — YES**

Advisory lock line 90 → idempotency SELECT lines 96-98 → replay/conflict return lines 100-111 → lock read line 134. Comment at line 93: *"Idempotency FIRST — before any lock/trip/passenger check, so a retry of a succeeded call replays even after its lock is long gone."*

**e. `lock_seats`: advisory lock + `unique_violation` → `SEAT_ALREADY_LOCKED`? — YES to both**

```sql
perform pg_advisory_xact_lock(hashtext(p_trip_id::text)::bigint);
```
`20260726135700_seat_map_and_locking.sql:132`

```sql
exception when unique_violation then
  … return jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'SEAT_ALREADY_LOCKED', …
```
same file, lines 239-251.

**f. `release_lock` returns FORBIDDEN for a non-owner? — YES, and the contrast holds**

```sql
if v_owner is distinct from v_uid then
  return jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'FORBIDDEN', 'message', 'Not your lock', 'details', null));
```
`20260726135700_seat_map_and_locking.sql:285-287`

vs `create_booking`, which folds a foreign lock into `LOCK_EXPIRED` (`…_single_snapshot.sql:144`). Matches §4's asymmetry rule exactly.

---

## 4. app_config

| key | value | seeded in | read by |
|---|---|---|---|
| `lock_ttl_minutes` | `10` | mig 1 | `lock_seats` |
| `cancel_window_hours` | `2` | mig 1 | `cancel_booking` |
| `max_active_bookings_per_user` | `4` | mig 1 | `create_booking` |
| `max_active_bookings_per_phone_per_trip` | `4` | mig 1 | `create_booking` |
| `lookup_rate_limit_max` | `10` | mig 7 | `lookup_booking` |
| `lookup_rate_limit_window_minutes` | `60` | mig 7 | `lookup_booking` |

RLS on, zero policies, no grants → unreadable by anon/authenticated (asserted by `smoke.test.ts:31`).

### Bare-literal grep (10 / 2 / 4 / 600 in TTL / window / limit positions)

| hit | location | verdict |
|---|---|---|
| `c_pnr_tries constant int := 10;` | `20260727120000_booking_rpcs.sql:243` and `20260727130000_…:58` | PNR retry budget. A "limit" by shape, though not a business policy value. Not in `app_config`. |

No other hit. Every TTL / window / booking-limit value is read from `app_config` via `select ((value)::text)::int`; the only intervals are `make_interval(mins => v_ttl)`, `make_interval(hours => v_hours)`, `make_interval(mins => v_window)` — all config-fed. No `600` anywhere in the migrations.

Adjacent policy numbers living outside `app_config` (not in the requested set, recorded for completeness):

- `check (commission_rate between 0.20 and 0.35)` — `schema_rls_hook.sql:36`. Changing the band requires a migration.
- `generate_series(1, 6)` + the 32-char alphabet in `generate_pnr` — PNR length/alphabet hardcoded.
- `LOCK_TTL_MS = 10 * 60_000` in `src/mocks/handlers.ts:43` — frontend MSW mirror of `lock_ttl_minutes`; drifts silently if the config key changes.

---

## 5. FRONTEND TRANSPORT STATE

### `src/features/*/api.ts`

| file | function | transport | callRpc variant | `p_`-prefixed args sent |
|---|---|---|---|---|
| `search/api.ts` | `fetchCities` | supabase | none — `.from("cities").select("id,name_ar,name_en,slug")` | n/a |
| `search/api.ts` | `fetchTrips` | supabase | `callRpcBare` | `p_from_slug`, `p_to_slug`, `p_travel_date`, `p_passengers` |
| `search/api.ts` | `getTrip` | supabase | `callRpc` | `p_trip_id` |
| `booking/api.ts` | `fetchSeatMap` | axios/MSW — `GET /api/trips/:id/seats` | none | none |
| `booking/api.ts` | `lockSeats` | axios/MSW — `POST /api/trips/:id/seats/lock` | none | none |
| `booking/api.ts` | `releaseLock` | axios/MSW — `POST /api/locks/:lockId/release` | none | none |
| `booking/api.ts` | `createBooking` | axios/MSW — `POST /api/bookings` | none | none |

`fetchTrips` pins `p_passengers: 1` — `TripSearchParams` carries no passenger count, so the URL's `passengers` never reaches the RPC.

### MSW handlers still registered (`src/mocks/handlers.ts`)

| method + path | status |
|---|---|
| `GET /api/trips/:id/seats` | registered |
| `POST /api/trips/:id/seats/lock` | registered |
| `POST /api/locks/:lockId/release` | registered |
| `POST /api/bookings` | registered |
| `POST /api/bookings/lookup` | registered |
| `GET /api/cities` | removed (E2) |
| `GET /api/trips/search` | removed (E2) |
| `GET /api/trips/:id` | removed (E2) |

`POST /api/bookings/lookup` has **no frontend caller** — `/tickets/lookup` is E4, unbuilt. It is a live handler for a route nothing requests.

### Is the worker still started? — YES

- `src/config/env.ts:4` — `NEXT_PUBLIC_USE_MOCKS: z.enum(["true","false"]).default("true")`. **Defaults to on when unset.**
- `.env.local` — `NEXT_PUBLIC_USE_MOCKS=true`.
- `src/mocks/init.ts:3` — `const mocksEnabled = env.NEXT_PUBLIC_USE_MOCKS === "true"`; `mocksReady()` returns `Promise.resolve()` when off or on the server, else dynamic-imports `./browser` and calls `worker.start({ onUnhandledRequest: "bypass" })`.
- `src/providers/mock-provider.tsx:15-17` — `useEffect(() => { void mocksReady(); }, [])`, mounted in `src/app/layout.tsx:34`.
- `"bypass"` is what lets the Supabase calls in `search/api.ts` through untouched while the worker is running.

### `src/lib/rpc.ts` — exact signatures

```ts
export async function callRpc<N extends RpcName, T>(
  client: NaqlClient,
  name: N,
  args: RpcArgs<N>,
  schema: z.ZodType<T>,
): Promise<T>

export async function callRpcBare<N extends RpcName, T>(
  client: NaqlClient,
  name: N,
  args: RpcArgs<N>,
  schema: z.ZodType<T>,
): Promise<T>
```

`callRpc` = `client.rpc()` → `transportError` on a PostgrestError → `unwrap(data, schema)`.
`callRpcBare` = same, but `schema.parse(data)` with no envelope peel.

### `src/lib/supabase/`

| file | client | trust boundary |
|---|---|---|
| `browser.ts` | `createBrowserClient` (`@supabase/ssr`) | anon key **with persisted session**; browser only; degrades silently on the server |
| `server.ts` | `createServerClient` (`@supabase/ssr`), async | anon key **with the caller's cookie session**; fresh per request; `setAll` is a no-op in Server Components until a Phase-D `middleware.ts` exists |
| `public.ts` | `createClient` (`@supabase/supabase-js`), module-cached | anon key, **no session ever**; for SEO-facing server-rendered public pages |
| `credentials.ts` | — | shared `supabaseCredentials()` helper; throws when either env var is missing |

All three catalog calls currently use `browserClient()`. `server.ts` and `public.ts` have **no callers anywhere in `src/`**.

---

## 6. CONTRACT DIVERGENCES

RPC output vs `src/features/*/schemas.ts`, field by field. Only mismatches are listed; every field not listed matches.

| field | RPC emits | zod expects | which side looks wrong |
|---|---|---|---|
| `company.logoUrl` (`search_trips`, `get_trip`, `booking_ticket.trip`) | `c.logo_url` — column is `text` **NULLABLE** | `z.string()` — non-nullable | **DB/contract.** One approved company with a null logo makes the whole `search_trips` array fail `tripSearchListSchema.parse()` → /search shows the error state, not one broken card. Seed hides it (all 3 approved companies have logos). |
| `company.rating` (same three) | `c.rating` — `numeric(2,1)` **NULLABLE** | `z.number()` — non-nullable | **DB/contract.** Same blast radius. §2's example shows both fields always present. |
| `busType` (same three) | `b.bus_type` — `text not null`, **no CHECK, no enum** | `z.enum(["عادي","VIP"])` | **DB.** Any other string (a new bus type, a typo) fails the parse for the entire result set. The DB has no constraint holding the frontend's two-value assumption. |
| `layout` (`get_seat_map`) | raw `buses.layout` jsonb passthrough, **`jsonb not null` with no shape constraint** | `{ rows:int, cols:int, aisleAfterCol:int }` all required | **DB.** A bus row missing `aisleAfterCol` fails the seat-map parse. Seed is correct; nothing enforces it. |
| `p_*` argument names (all RPCs) | `p_from_slug`, `p_to_slug`, `p_travel_date`, `p_passengers`, `p_trip_id`, `p_lock_id`, `p_seats`, `p_idempotency_key`, `p_payment_method`, `p_passengers`, `p_booking_id`, `p_id`, `p_pnr`, `p_phone` | — | **Doc.** BACKEND_V1 §2/§3/§4 document them unprefixed (`from_slug`, `trip_id`, `lock_id`, `idempotency_key`, …). Calling with the documented names is a PostgREST 404. Still unfixed in the doc. |
| `cities.name_ar` / `name_en` | PostgREST returns **column names** (snake_case) | `citySchema` = `nameAr` / `nameEn` | **Doc.** §2 line 52 claims `[{ id, nameAr, nameEn, slug }]`. camelCase aliasing only happens inside RPC `json_build_object`. Frontend maps it in `fetchCities` — schema untouched. |
| `companies.logo_url` / `tripsCount` | table read returns `logo_url`; **there is no `tripsCount` column** | §2 line 53 documents `{ id, name, logoUrl, rating, tripsCount }` | **Doc.** Latent — no consumer yet (`/companies/[slug]` still reads `@/mocks/data`). Lands on E4. |

### Four specific confirmations

| question | answer |
|---|---|
| booking `status`: `z.literal("confirmed")` or wider enum? | **Wider enum.** `bookingStatusSchema = z.enum(["confirmed","cancelled"])` — `src/features/booking/schemas.ts:66`, consumed at line 71. Correct per §4: `create_booking` only ever emits `confirmed`, but `get_booking` / `lookup_booking` / `cancel_booking` can emit `cancelled`. **No divergence.** |
| does `searchTrips` still read `.items`? | **No — bare array end to end.** `search_trips` returns `coalesce(jsonb_agg(...), '[]'::jsonb)`; `callRpcBare` does `schema.parse(data)` with no unwrap; `tripSearchListSchema = z.array(tripSearchItemSchema)`. Grep for `.items` across `src/features/` returns only a prose comment in `search/api.ts:66` and unrelated `items={}` props on shadcn `Select`. **No divergence.** |
| is `error.details` parsed with `.nullish()`? | **Yes.** `details: z.record(z.string(), z.unknown()).nullish()` — `src/lib/envelope.ts:15`. Both halves are pinned by tests: `tests/unit/envelope.test.ts` (absent key + explicit null both → `ApiError`, never `ZodError`) and `tests/db/envelope.test.ts` (RPCs really do emit `details: null`). **No divergence.** |
| seat map emits `number` while lock/create accept `seatNumber` — still true? | **Still true, and deliberate (§3).** `get_seat_map` → `'number', g.n::text`; `lock_seats` → `value->>'seatNumber'`; `create_booking` → `value->>'seatNumber'`; `booking_ticket` → `'seatNumber', bp.seat_number`. Frontend matches: `seatSchema.number` vs `seatSelectionSchema.seatNumber` / `bookingPassengerSchema.seatNumber`. **No divergence.** |

Nothing above was fixed.

---

## 7. TESTS

### `tests/db/`

| file | describes | `it()` | coverage |
|---|---|---|---|
| `booking.test.ts` | 11 | 29 | `create_booking` idempotency · double-booking · lock validation · passenger validation · response + side effects · limits; PNR ×200; `cancel_booking`; `get_booking` + bookings-mine RLS; `lookup_booking`; trip-departed-mid-flight |
| `catalog.test.ts` | 2 | 7 | `search_trips` §2 shape, suspension takes effect next call, 23:30 Damascus date boundary, availableSeats vs unexpired/expired lock; `get_trip` departed / draft / missing |
| `concurrency.test.ts` | 1 | 7 | **merge gate** — 10 parallel same-seat, overlapping [5,6]/[6,7], expiry frees seat, release ownership, gender propagation cross-session, no-session UNAUTHORIZED, off-layout seat VALIDATION_ERROR |
| `rls.test.ts` | 3 | 7 | public reads (cities, published-future trips, draft hidden, pending company hidden); private reads (others' bookings); direct anon INSERT on trips + bookings denied |
| `claims.test.ts` | 1 | 3 | access-token hook: operator `user_role`+`company_id`, admin, anonymous → passenger |
| `smoke.test.ts` | 1 | 3 | anon session has `auth.uid()`; `app_config` seeded; `app_config` denied to anon |
| `envelope.test.ts` | 1 | 1 decl / **2 cases** (loop over `get_trip`, `get_seat_map`) | §0 `details` is present-and-null, not absent |
| **total** | 20 | 57 decl / 58 cases | |

`tests/unit/envelope.test.ts` (separate config, `npm test`): 2 describes, 4 `it()` — frontend `unwrap()` half of the `details` rule.

### [AUTO] P0 coverage map — the gaps

28 P0 `[AUTO]` IDs in `docs/V1_TEST_PLAN.md`. **13 fully matched, 6 partial, 9 unmatched.**

| P0 [AUTO] ID | case | status |
|---|---|---|
| T-LOCK-3 | `lock_seats` on an already-**booked** seat → `SEAT_ALREADY_BOOKED`, nothing locked | **none.** `concurrency.test.ts` never books a seat first; `booking.test.ts:287` tests the same code on `create_booking`, not `lock_seats`. The `lock_seats` booked-conflict branch (`seat_map_and_locking.sql:191-205`) is untested. |
| T-SEC-1 | grants audit: enumerate anon-callable functions = exactly the 9 public RPCs | **none** |
| T-OPR1-2 | operator tenant isolation across `get_manifest` / `update_trip` / `operator_cancel_booking` / trips select — *launch blocker* | **none** — no operator RPCs exist |
| T-OPR2-2 | price change on a published trip leaves existing bookings' totals untouched | **none** |
| T-OPR3-3 | tampered `qrPayload` / other company's QR rejected | **none** — no `check_in` RPC exists |
| T-ADM1-2 | `set_company_status` commissionRate 0.19 / 0.36 / 0.30 | **none** — no admin RPC; only the CHECK constraint exists |
| T-ADM-SEC | operator/anonymous calling any admin RPC → FORBIDDEN | **none** — no admin RPCs |
| T-PERF-1 | k6: `get_seat_map`, 200 concurrent viewers, p95 < 50ms | **none** — `tools/load/` absent |
| T-PERF-2 | k6: `lock_seats` burst, correctness under load, p95 < 200ms | **none** — `tools/load/` absent |

Partial (assertion exists but narrower than the plan):

| ID | gap |
|---|---|
| T-PAS1-6 | suspension + published-future covered; **no AUTO assertion that a `draft` trip is absent from `search_trips` output** (`rls.test.ts:39` covers the direct table read, not the RPC) |
| T-PAS4-8 | gender-on-locked and gender-on-booked covered separately; no single test asserting all three statuses **and** gender absent on `available` |
| T-LOCK-5 | non-owner FORBIDDEN + owner-frees covered; **"release a gone lock → ok (idempotent)" not asserted** |
| T-SEC-2 | anon INSERT denied on `trips` + `bookings`; **`seat_locks` and `companies` untested** |
| T-SEC-3 | draft trips / pending companies / others' bookings covered; **`profiles` untested** |
| T-SEC-5 | envelope shape pinned for `get_trip` + `get_seat_map` only, not "every failure path exercised above" |

Fully matched: T-LOCK-1, T-LOCK-2, T-LOCK-4, T-LOCK-6, T-PAS6-7, T-PAS6-9, T-PAS6-10, T-PAS6-12, T-PAS6-13, T-PAS7-2, T-PAS8-2, T-PAS10-3, T-PAS11-2.

Framing: 6 of the 9 unmatched (T-OPR*, T-ADM*) are untestable today — BACKEND_V1 §5/§6 has no implementation. The three that *are* actionable now are **T-LOCK-3**, **T-SEC-1**, and the k6 pair.

---

## 8. TOOLING + CI

### `tools/qa/`

| script | what it does | needs service role |
|---|---|---|
| `prelock-seat-13.ts` | Inserts a far-future `seat_locks` + `seat_lock_seats` row holding seat "13" on a seeded trip (default: الأمانة دمشق→حلب n=1), releasing any prior lock on that seat first. Reproduces the MSW conflict trigger on DEV. Backs T-LOCK-7. | **yes** — `SUPABASE_SERVICE_ROLE_KEY` from `.env.test`; writes to RLS-denied tables |
| `shorten-lock.ts` | Moves a lock's `expires_at` into the past (or `--in <s>`), by `lockId` or `--trip <id>` (newest lock). Keeps the ROW so `create_booking` still finds it and returns `LOCK_EXPIRED`. Backs T-PAS5-3 / T-PAS6-11. | **yes** — same |

### `tools/load/`

**absent.** No directory, no k6 scripts. T-PERF-1 / T-PERF-2 have no implementation.

### `db:*` scripts (verbatim from `package.json`)

```json
"db:whoami": "supabase projects list && node -e \"console.log('LINKED=' + require('fs').readFileSync('supabase/.temp/project-ref','utf8').trim())\"",
"db:reset": "dotenv -e .env.test -- cmd /c \"echo y| supabase db reset --linked\"",
"db:types": "dotenv -e .env.test -- supabase gen types typescript --linked > src/types/database.ts",
"db:test": "vitest run -c vitest.db.config.ts"
```

`db:reset` is Windows-only (`cmd /c`) and targets the **linked hosted DEV project**, not a local stack.

### `.github/workflows/ci.yml`

Triggers: `push` to `main` · `pull_request` (any branch) · `workflow_dispatch` (present for the B3 five-green-runs merge gate).

| job | condition | steps |
|---|---|---|
| `changes` | always | `dorny/paths-filter@v3` → outputs `web`, `db` |
| `web` | `changes.web == 'true'` **or** `workflow_dispatch` | node 22, `npm ci`, `npx tsc --noEmit`, `npm run lint`, `npm run build` |
| `db` | `changes.db == 'true'` **or** `workflow_dispatch` | install Supabase CLI, validate `config.toml` parses (fast-fail on parse error only), node 22, `npm ci`, `supabase start`, debug GoTrue env, **`supabase db reset`**, export local-stack creds into `$GITHUB_ENV` with renamed keys, verify creds, `npm run db:test` (with seeded operator/admin creds), diff committed vs generated types (normalised to ignore the `__InternalSupabase` preamble), `supabase stop` (`if: always()`) |

Path filters:

- `web`: `src/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `.github/workflows/ci.yml`
- `db`: `supabase/**`, `tests/db/**`, `vitest.db.config.ts`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml`

Supabase CLI pinned: **`2.109.1`** via `supabase/setup-cli@v1` (comment notes it matches the `package.json` devDependency).

Gap: neither filter covers `tests/unit/**` or `vitest.config.ts`, so the frontend unit suite is not a path trigger — and no job runs `npm test` at all. `tests/unit/envelope.test.ts` never executes in CI.

---

## 9. TYPES FRESHNESS

| target | last commit |
|---|---|
| `src/types/database.ts` | `1d065b5` — 2026-07-27 08:21:50 +0300 — "feat: B4 — booking, idempotency, lookup, limits" |
| `supabase/migrations/` (committed) | `1d065b5` — 2026-07-27 08:21:50 +0300 — same commit |

**Not stale by commit comparison** — types and migrations were last written in the *same* commit.

Caveat: `supabase/migrations/20260727130000_create_booking_lock_single_snapshot.sql` is **untracked**, so in the working tree there is a migration newer than the types file. It only issues `create or replace function public.create_booking(uuid, uuid, text, jsonb) returns jsonb` — identical name, identical argument types, identical return type to the version already in `database.ts`. The generated `Functions.create_booking` block would therefore be unchanged, so the committed types are very likely still accurate. Not verified — `npm run db:types` was not run, per instruction. CI's "Generated types are committed and fresh" step will decide it once that migration is committed.

---

## 10. OPEN QUESTIONS

1. `20260727130000_create_booking_lock_single_snapshot.sql` is untracked — has it been applied to hosted DEV already, and is it intended for the next commit, or is it a scratch fix that should be squashed into a different migration before anyone else pulls?
2. `companies.logo_url` and `companies.rating` are nullable while `tripSearchItemSchema` requires both. Should the DB gain `NOT NULL` (or a CHECK gated on `status = 'approved'`), or should §2 and the zod schema declare them nullable? This decides whether one bad company row breaks all of /search.
3. `buses.bus_type` is unconstrained `text` while the frontend enum is exactly `["عادي","VIP"]`. Is a third bus type ever expected in v1? If not, should it become a Postgres enum or a CHECK?
4. `search_trips` takes `p_passengers` but no frontend caller supplies it (pinned to 1). Is filtering by passenger count in scope for v1, which would mean widening `TripSearchParams` and `useSearchTrips`?
5. `get_trip(p_trip_id uuid)` rejects a malformed id at the type boundary (Postgres 22P02 → transport error), so `/trips/not-a-uuid` renders the generic error card instead of the not-found card. Should the RPC accept `text` and validate, or is a malformed id explicitly out of contract?
6. `POST /api/bookings/lookup` is a live MSW handler with no caller. Is `/tickets/lookup` (E4) expected before or after E3 removes the rest of the booking handlers?
7. `NEXT_PUBLIC_USE_MOCKS` defaults to `"true"` when unset (`src/config/env.ts:4`). Is that the intended production default, given a missing env var on the deploy target would silently ship MSW?
8. `tools/load/` does not exist. Who owns the k6 suite for T-PERF-1/2, and is it a launch gate given §11 lists the k6 targets as a checklist item?
9. T-LOCK-3 (`lock_seats` on a booked seat) and T-SEC-1 (anon grants audit) are P0 [AUTO] with no test and no blocking dependency. Should they be written before E3, since E3 switches the frontend onto `lock_seats` for real?
10. CI never runs `npm test`, so `tests/unit/` is unexecuted. Intentional, or an omission in the `web` job?
11. `service_role` holds EXECUTE on `qr_hmac_secret()` via mig 3's default privileges, despite the explicit `revoke … from public, anon, authenticated`. Acceptable (service_role reads Vault directly anyway), or should it be revoked for defence in depth?
