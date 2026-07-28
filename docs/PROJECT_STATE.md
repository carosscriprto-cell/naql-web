# PROJECT_STATE — audit

**Audited commit:** `4e9315150177e5d18d33e8c8ea2ae79ac8afe6fd` (`main`, "fix: create_booking single-snapshot lock read; nullable company fields; thread passengers")
**Working tree:** DIRTY — 5 modified tracked files, 5 untracked migrations, 2 untracked test files, 1 untracked tool dir. **The audit describes the WORKING TREE, not the commit**; where they differ it is called out.
**Repo root:** `d:\x-bus\naql-web` (the `d:\x-bus` parent is not a git repo).
**Date:** 2026-07-28
**Hosted DEV probed live:** `https://gidodxojpvztrsihnqxj.supabase.co` (REST + Auth reachable; direct Postgres port times out from this machine).

> **Code is source of truth; docs unverified until reconciled.**

---

## 0. The three headline facts

| # | Fact | Evidence |
|---|---|---|
| 1 | **Hosted DEV is 5 migrations behind the repo.** `trip_seat_map_version`, all operator RPCs, `role_executable_functions`, the `create_booking` FOR UPDATE row lock, and `get_trip(text)` do not exist on DEV. | Live probe: `PGRST205` for `trip_seat_map_version`; `PGRST202` for `get_manifest`/`check_in`/`create_bus`/`operator_summary`/`role_executable_functions`/`anon_executable_functions`; `get_trip("not-a-uuid")` → `22P02` (the uuid overload is still the live one) |
| 2 | **The booking half of the frontend was never cut over.** `src/features/booking/api.ts` still calls axios `/api/*` through MSW. Task E3 in `docs/FRONTEND_REMAINING.md` is unexecuted, yet E5 (Realtime) was executed. | [api.ts:3](src/features/booking/api.ts#L3), [api.ts:19](src/features/booking/api.ts#L19), [use-seat-map.ts:68-95](src/features/booking/hooks/use-seat-map.ts#L68-L95) |
| 3 | **`signInAnonymously()` exists nowhere in `src/`.** It is referenced only in a doc comment. Every write RPC returns `UNAUTHORIZED` without it. | `grep -rn signInAnonymously src/` → 1 hit, [browser.ts:11](src/lib/supabase/browser.ts#L11) (comment) |

---

## STEP 2 — Contract conformance

### 2.1 Every RPC in `supabase/migrations/` (final effective definition)

`SD+sp` = `security definer` **and** `set search_path = public`. **Live?** = exists on hosted DEV today.

| # | function | args (final signature) | envelope | SD+sp | GRANTs | live? | BACKEND_V1 § | called from |
|---|---|---|---|---|---|---|---|---|
| 1 | `search_trips` | `p_from_slug text, p_to_slug text, p_travel_date date, p_passengers int` | **bare array** | ✅ [catalog_rpcs.sql:26-28](supabase/migrations/20260726125327_catalog_rpcs.sql#L26-L28) | anon+auth [:149-150](supabase/migrations/20260726125327_catalog_rpcs.sql#L149-L150) | ✅ | §2 | [search/api.ts:75](src/features/search/api.ts#L75) |
| 2 | `get_trip` | `p_trip_id **text**` (uuid overload dropped) | envelope | ✅ [get_trip_accepts_text_id.sql:42-44](supabase/migrations/20260727170500_get_trip_accepts_text_id.sql#L42-L44) | anon+auth [:106-107](supabase/migrations/20260727170500_get_trip_accepts_text_id.sql#L106-L107) | ❌ **DEV has `(uuid)`** | §2 (doc updated, uncommitted) | [search/api.ts:95](src/features/search/api.ts#L95) |
| 3 | `get_seat_map` | `p_trip_id uuid` | envelope | ✅ [get_seat_map_envelope.sql:9-11](supabase/migrations/20260726141549_get_seat_map_envelope.sql#L9-L11) | anon+auth [:82-83](supabase/migrations/20260726141549_get_seat_map_envelope.sql#L82-L83) | ✅ | §3 | **NOT CALLED** — [booking/api.ts:19](src/features/booking/api.ts#L19) uses axios |
| 4 | `lock_seats` | `p_trip_id uuid, p_seats jsonb` | envelope | ✅ [seat_map_and_locking.sql:109-110](supabase/migrations/20260726135700_seat_map_and_locking.sql#L109-L110) | anon+auth [:261-262](supabase/migrations/20260726135700_seat_map_and_locking.sql#L261-L262) | ✅ | §3 | **NOT CALLED** — [booking/api.ts:28](src/features/booking/api.ts#L28) |
| 5 | `release_lock` | `p_lock_id uuid` | envelope | ✅ [:271-272](supabase/migrations/20260726135700_seat_map_and_locking.sql#L271-L272) | anon+auth [:295-296](supabase/migrations/20260726135700_seat_map_and_locking.sql#L295-L296) | ✅ | §3 | **NOT CALLED** — [booking/api.ts:34](src/features/booking/api.ts#L34) |
| 6 | `create_booking` | `p_lock_id uuid, p_idempotency_key uuid, p_payment_method text, p_passengers jsonb` | envelope | ✅ [row_lock.sql:63-64](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L63-L64) | anon+auth [:447-448](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L447-L448) | ⚠️ **live but WITHOUT the FOR UPDATE fix** | §4 | **NOT CALLED** — [booking/api.ts:42](src/features/booking/api.ts#L42) |
| 7 | `cancel_booking` | `p_booking_id uuid` | envelope | ✅ [booking_rpcs.sql:573-574](supabase/migrations/20260727120000_booking_rpcs.sql#L573-L574) | anon+auth [:620-621](supabase/migrations/20260727120000_booking_rpcs.sql#L620-L621) | ✅ | §4 | **no caller anywhere** |
| 8 | `get_booking` | `p_id uuid` ← **not `p_booking_id`** | envelope | ✅ [:632-633](supabase/migrations/20260727120000_booking_rpcs.sql#L632-L633) | anon+auth [:658-659](supabase/migrations/20260727120000_booking_rpcs.sql#L658-L659) | ✅ | §4 | **no caller** |
| 9 | `lookup_booking` | `p_pnr text, p_phone text` | envelope | ✅ [:679-680](supabase/migrations/20260727120000_booking_rpcs.sql#L679-L680) | anon+auth [:726-727](supabase/migrations/20260727120000_booking_rpcs.sql#L726-L727) | ✅ | §4 | **no caller** (MSW handler exists, unused: [handlers.ts:247](src/mocks/handlers.ts#L247)) |
| 10 | `create_trip` | `p_route_id uuid, p_bus_id uuid, p_departure_at timestamptz, p_arrival_at timestamptz, p_price int` | envelope | ✅ | revoke anon; **authenticated** [:131-132](supabase/migrations/20260727160000_operator_rpcs.sql#L131-L132) | ❌ | §5 | none (operator UI is a placeholder) |
| 11 | `update_trip` | `p_trip_id uuid, p_price int=null, p_departure_at tstz=null, p_arrival_at tstz=null, p_status text=null` | envelope | ✅ | authenticated [:216-217](supabase/migrations/20260727160000_operator_rpcs.sql#L216-L217) | ❌ | §5 | none |
| 12 | `cancel_trip` | `p_trip_id uuid` | envelope | ✅ | authenticated [:280-281](supabase/migrations/20260727160000_operator_rpcs.sql#L280-L281) | ❌ | §5 | none |
| 13 | `get_manifest` | `p_trip_id uuid` | envelope | ✅ | authenticated [:351-352](supabase/migrations/20260727160000_operator_rpcs.sql#L351-L352) | ❌ | §5 | none |
| 14 | `check_in` | `p_qr_payload text` | envelope | ✅ | authenticated [:494-495](supabase/migrations/20260727160000_operator_rpcs.sql#L494-L495) | ❌ | §5 | none |
| 15 | `check_in_by_pnr` | `p_pnr text` | envelope | ✅ | authenticated [:535-536](supabase/migrations/20260727160000_operator_rpcs.sql#L535-L536) | ❌ | §5 | none |
| 16 | `operator_cancel_booking` | `p_booking_id uuid` | envelope | ✅ | authenticated [:589-590](supabase/migrations/20260727160000_operator_rpcs.sql#L589-L590) | ❌ | §5 | none |
| 17 | `create_bus` | `p_plate_number text, p_bus_type text, p_layout jsonb` | envelope | ✅ | authenticated [:664-665](supabase/migrations/20260727160000_operator_rpcs.sql#L664-L665) | ❌ | §5 | none |
| 18 | `update_bus` | `p_bus_id uuid, p_plate_number text=null, p_bus_type text=null, p_layout jsonb=null` | envelope | ✅ | authenticated [:736-737](supabase/migrations/20260727160000_operator_rpcs.sql#L736-L737) | ❌ | §5 | none |
| 19 | `operator_summary` | `p_from_date date, p_to_date date` | envelope | ✅ | authenticated [:836-837](supabase/migrations/20260727160000_operator_rpcs.sql#L836-L837) | ❌ | §5 | none |
| 20 | `operator_trip_json` | `p_trip_id uuid` (internal) | raw jsonb | ✅ | revoked from public/anon/authenticated [:65](supabase/migrations/20260727160000_operator_rpcs.sql#L65) | ❌ | — | internal |
| 21 | `check_in_booking` | `p_booking_id uuid, p_company_id uuid` (internal) | envelope | ✅ | revoked from all client roles [:433](supabase/migrations/20260727160000_operator_rpcs.sql#L433) | ❌ | — | internal |
| 22 | `booking_ticket` | `p_booking_id uuid` (internal) | raw jsonb | ✅ | revoked public/anon/auth [:197](supabase/migrations/20260727120000_booking_rpcs.sql#L197); **also from service_role** [b7:34](supabase/migrations/20260727170000_b7_grants_hardening.sql#L34) | ⚠️ live, service_role revoke NOT live | §4 | internal |
| 23 | `qr_hmac_secret` | none (internal) | raises | ✅ | revoked public/anon/auth [:93](supabase/migrations/20260727120000_booking_rpcs.sql#L93); service_role [b7:32](supabase/migrations/20260727170000_b7_grants_hardening.sql#L32) | ⚠️ same | §4 | internal |
| 24 | `generate_pnr` | none (internal) | text | ⚠️ **no `security definer`**, `set search_path` only [:103-104](supabase/migrations/20260727120000_booking_rpcs.sql#L103-L104) | revoked public/anon/auth [:113](supabase/migrations/20260727120000_booking_rpcs.sql#L113); service_role [b7:33](supabase/migrations/20260727170000_b7_grants_hardening.sql#L33) | ⚠️ same | §4 | internal |
| 25 | `role_executable_functions` | `p_role text` | text[] | ✅ | service_role only [b7:92-93](supabase/migrations/20260727170000_b7_grants_hardening.sql#L92-L93) | ❌ | — | [security.test.ts](tests/db/security.test.ts) |
| 26 | `bump_seat_map_version` | trigger | — | ✅ [realtime.sql:48-49](supabase/migrations/20260728100000_realtime_seat_map_version.sql#L48-L49) | revoked public/anon/auth [:77](supabase/migrations/20260728100000_realtime_seat_map_version.sql#L77) | ❌ | — | triggers |
| 27 | `custom_access_token_hook` | `event jsonb` | jsonb | ⚠️ **no `security definer`** (stable + `set search_path`) [hook:150-152](supabase/migrations/20260725202100_schema_rls_hook.sql#L150-L152) | `supabase_auth_admin` only [:180-181](supabase/migrations/20260725202100_schema_rls_hook.sql#L180-L181) | ✅ verified live | §1 | GoTrue |
| 28 | `anon_executable_functions` | none | text[] | ✅ | service_role [:496-497](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L496-L497) | ❌ | — | **DROPPED** by [b7:57](supabase/migrations/20260727170000_b7_grants_hardening.sql#L57) — dead |

**Total:** 26 live functions in the repo after `anon_executable_functions` is dropped and the `get_trip(uuid)` overload is dropped.

### 2.2 Mismatch flags

| kind | detail | verdict |
|---|---|---|
| **function name** | No mismatches. Every function named in §2/§3/§4/§5 exists with that name. | ✅ |
| **function name — missing** | §6 Admin names `set_company_status`, `commissions_by_month`. **Neither exists in any migration.** No admin migration was ever written (Task B6 in `docs/CLAUDE_CODE_PROMPTS_BACKEND.md:257`). | ❌ doc claims code that does not exist |
| **argument names** | Every parameter IS `p_`-prefixed in code. But §3/§4/§5 code samples still show them unprefixed: `get_seat_map({trip_id})` [§3:92], `lock_seats({trip_id, seats})` [§3:109], `release_lock({lock_id})` [§3:113], `create_booking({lock_id, idempotency_key, payment_method, passengers})` [§4:132-136], `get_booking({id})` [§4:163], `lookup_booking({pnr, phone})` [§4:164], `cancel_booking({id})` [§4:166], and all of §5. §2:58 states the `p_` rule in prose, so the samples contradict the rule stated three paragraphs above them. | ❌ doc samples stale |
| **argument name — internal inconsistency** | `get_booking(**p_id**)` vs `cancel_booking(p_booking_id)` / `operator_cancel_booking(p_booking_id)`. Same concept, two names. | ⚠️ code inconsistent |
| **argument name — operator range** | §5 documents `operator_summary({from, to})`; code is `p_from_date, p_to_date`. Not just the prefix — the stem differs. | ❌ doc |
| **field casing** | All RPC outputs are camelCase via `json_build_object`. Verified field-for-field in §2.3 below. `get_seat_map` emits `number` while `lock_seats`/`create_booking` accept `seatNumber` — deliberate, §3:106. | ✅ |
| **field casing — PostgREST** | `.from("cities")` returns snake_case; renamed at the transport edge in [search/api.ts:48-53](src/features/search/api.ts#L48-L53). §2:62 documents this correctly. | ✅ |
| **error codes** | Exactly 11 distinct codes are emitted across every migration: `BOOKING_LIMIT_REACHED, CANCEL_WINDOW_CLOSED, FORBIDDEN, IDEMPOTENCY_CONFLICT, LOCK_EXPIRED, NOT_FOUND, SEAT_ALREADY_BOOKED, SEAT_ALREADY_LOCKED, TRIP_DEPARTED, UNAUTHORIZED, VALIDATION_ERROR`. That is the §0 enum, complete, with **zero** extras. | ✅ **clean** |
| **`details.seats` shape** | `lock_seats` emits `details: {seats: [<text>, …]}` in **request order**, booked before locked, on both the pre-check path [:203-204](supabase/migrations/20260726135700_seat_map_and_locking.sql#L203-L204) / [:219-220](supabase/migrations/20260726135700_seat_map_and_locking.sql#L219-L220) and the unique-violation path [:249-251](supabase/migrations/20260726135700_seat_map_and_locking.sql#L249-L251) (with `coalesce(..., '[]')`). Matches §3:111-112. Consumed at [seat-selection.tsx:70-72](src/features/booking/components/seat-selection.tsx#L70-L72). | ✅ |
| **`details.seats` — extra use** | `VALIDATION_ERROR` for an off-layout seat ALSO uses `details.seats` [:185-186](supabase/migrations/20260726135700_seat_map_and_locking.sql#L185-L186). §3:117 mentions the code but not the details shape. The frontend only reads `details.seats` for the two conflict codes, so no live impact. | ⚠️ doc silent |
| **`details` null rule** | Every non-details error path emits `'details', null`. Parser uses `.nullish()` [envelope.ts:15](src/lib/envelope.ts#L15). Pinned both sides: [tests/db/envelope.test.ts:43](tests/db/envelope.test.ts#L43), [tests/unit/envelope.test.ts:42](tests/unit/envelope.test.ts#L42). | ✅ |

### 2.3 RPC output vs zod, field for field

| zod schema | RPC | fields | verdict |
|---|---|---|---|
| `tripSearchItemSchema` [schemas.ts:14-35](src/features/search/schemas.ts#L14-L35) | `search_trips` [:40-53](supabase/migrations/20260726125327_catalog_rpcs.sql#L40-L53) | `id, company{id,name,logoUrl,rating}, fromCity{id,nameAr}, toCity{id,nameAr}, departureAt, arrivalAt, price, currency, availableSeats, busType` | ✅ **exact, 11/11.** `logoUrl`/`rating` are `.nullable()` on both sides (STATE_REPORT §6's top-two divergences are now FIXED in code) |
| same | `get_trip` [:65-86](supabase/migrations/20260727170500_get_trip_accepts_text_id.sql#L65-L86) | + `cancellationPolicy` | ✅ matches `tripDetailSchema` [:44-46](src/features/search/schemas.ts#L44-L46) |
| same | `booking_ticket.trip` [:145-165](supabase/migrations/20260727120000_booking_rpcs.sql#L145-L165) | same 11, **no** `cancellationPolicy` | ✅ `bookingSchema.trip = tripSearchItemSchema` — correct |
| `busType` | all three | zod `z.enum(["عادي","VIP"])`; DB `buses.bus_type text not null`, **no CHECK, no enum** [schema:59](supabase/migrations/20260725202100_schema_rls_hook.sql#L59) | ⚠️ **latent break.** A third bus type fails the parse for the WHOLE array |
| `citySchema` [:7-12](src/features/search/schemas.ts#L7-L12) | PostgREST `cities` | snake_case → renamed in `fetchCities` | ✅ |
| `seatMapSchema` [:18-25](src/features/booking/schemas.ts#L18-L25) | `get_seat_map` [:71-74](supabase/migrations/20260726141549_get_seat_map_envelope.sql#L71-L74) | `layout` = raw `buses.layout` jsonb **passthrough**; `seats[{number,row,col,status,gender?}]` | ⚠️ **latent break.** zod requires `{rows,cols,aisleAfterCol}`; `buses.layout` is `jsonb not null` with no shape constraint. `create_bus` validates the shape [:640-646](supabase/migrations/20260727160000_operator_rpcs.sql#L640-L646) but nothing constrains rows written any other way |
| `seatSchema.gender` | `get_seat_map` [:60-64](supabase/migrations/20260726141549_get_seat_map_envelope.sql#L60-L64) | key ABSENT on available (`|| '{}'::jsonb`), present on locked/booked | ✅ exactly §3:105 |
| `lockResponseSchema` [:33-36](src/features/booking/schemas.ts#L33-L36) | `lock_seats` [:255-257](supabase/migrations/20260726135700_seat_map_and_locking.sql#L255-L257) | `lockId, expiresAt` | ✅ |
| `z.null()` [api.ts:35](src/features/booking/api.ts#L35) | `release_lock` [:282,291](supabase/migrations/20260726135700_seat_map_and_locking.sql#L282) | `data: null` | ✅ |
| `bookingSchema` [:68-76](src/features/booking/schemas.ts#L68-L76) | `booking_ticket` [:138-186](supabase/migrations/20260727120000_booking_rpcs.sql#L138-L186) | `id, pnr, status, qrPayload, trip, passengers[{seatNumber,fullName,phone,gender}], totalPrice` | ✅ **exact, 7/7** |
| `bookingStatusSchema` | `booking_ticket.status` | `confirmed \| cancelled` | ✅ §4:149-155 |
| — | `get_manifest`, `operator_summary`, `check_in`, `create_trip`, … | camelCase (`seatNumber, fullName, checkedInAt, paymentStatus, seatsCapacity, occupancyRate`, …) | **UNVERIFIED against zod — no frontend schema exists for any operator RPC** |

---

## STEP 3 — Drift table (undocumented decisions)

| Area | What the doc says (file §) | What the code does (file:line) | Impact | Resolution |
|---|---|---|---|---|
| **Frontend cutover order** | `FRONTEND_REMAINING.md` §Order: E3 (booking swap) → E4 (tickets) → E5 (realtime, "optional, post-launch") | E5 is **DONE** ([use-seat-map.ts:68-95](src/features/booking/hooks/use-seat-map.ts#L68-L95) + [realtime migration](supabase/migrations/20260728100000_realtime_seat_map_version.sql)); E3 is **NOT** ([booking/api.ts:3](src/features/booking/api.ts#L3) still axios); E4 has no routes at all | Realtime invalidates a query whose fetcher is MSW. The whole seat/lock/booking path is mock-only while the DB behind it is complete | **FIX CODE** |
| **Auth flow** | §1:42 + `FRONTEND_REMAINING.md` E3 line 97: "`signInAnonymously()` on first lock attempt" | Zero occurrences in `src/`. Only a comment at [browser.ts:11](src/lib/supabase/browser.ts#L11) | Every `auth.uid()`-gated RPC (`lock_seats`, `create_booking`, `cancel_booking`, `get_booking`, bookings-mine) returns `UNAUTHORIZED`. Verified live: anon `lock_seats` with no session → `UNAUTHORIZED` | **FIX CODE** |
| **Idempotency key transport** | §4:132 + `CLAUDE.md`: "travels in the request body / RPC arguments, never as an HTTP header" | ✅ Correct — [store.ts:70](src/features/booking/store.ts#L70) mints it in `setLock`, [checkout/page.tsx:92-99](src/app/booking/checkout/page.tsx#L92-L99) puts it in the payload body; `p_idempotency_key` is a plain RPC arg | none | — |
| **Idempotency key lifetime** | `CLAUDE.md`: "generated once per lock and reused on every retry" | [store.ts:70](src/features/booking/store.ts#L70) regenerates on every `setLock` — correct — but `clearLock()` [:71](src/features/booking/store.ts#L71) does **not** clear `idempotencyKey`, so a stale key survives into the next lock until `setLock` overwrites it | Latent only; `setLock` always precedes the next `createBooking` | **FIX CODE** (cosmetic) |
| **Schema vs §8 — `payload_hash`** | §8:216-218 lists it on `bookings` | Not in B1 [schema](supabase/migrations/20260725202100_schema_rls_hook.sql#L95-L107); added later by `alter table` [booking_rpcs.sql:20-21](supabase/migrations/20260727120000_booking_rpcs.sql#L20-L21) | none (present at runtime) | **FIX DOC** (note it lands in B4) |
| **Schema vs §8 — `lookup_attempts`** | §8:222 | Created in B4 [:29-33](supabase/migrations/20260727120000_booking_rpcs.sql#L29-L33), not B1 | none | **FIX DOC** |
| **Schema vs §8 — undocumented table** | §8 has no `trip_seat_map_version` | [realtime.sql:32-36](supabase/migrations/20260728100000_realtime_seat_map_version.sql#L32-L36) — new table, 2 triggers, publication membership, public read policy | A table anon can read is not in the schema sketch | **FIX DOC** |
| **Schema vs §8 — index** | §8:235 "Indexes minimum" | All 5 present + 2 extra (`seat_locks_trip_idx`, `seat_locks_expires_at_idx`) [:130-137](supabase/migrations/20260725202100_schema_rls_hook.sql#L130-L137) | none | — |
| **JWT claim name** | §1:43 + §5:171 say `auth.jwt()->>'role'` | Code uses **`user_role`**; the migration explains why (GoTrue owns `role` for `SET ROLE`) [:142-146](supabase/migrations/20260725202100_schema_rls_hook.sql#L142-L146). Verified live: operator token carries `role=authenticated, user_role=operator, company_id=…003` | Anyone reading §5 and writing a policy on `role` gets a silently-empty policy | **FIX DOC** |
| **RLS policies vs §8/§5** | §5:171 "**every** operator-visible table has a policy `company_id = (auth.jwt()->>'company_id')::uuid`" | Only `trips` [:246-251](supabase/migrations/20260725202100_schema_rls_hook.sql#L246-L251), `bookings` [:262-271](supabase/migrations/20260725202100_schema_rls_hook.sql#L262-L271), `booking_passengers` [:288-297](supabase/migrations/20260725202100_schema_rls_hook.sql#L288-L297). **`buses` has `using (true)` for anon+authenticated** [:229-231](supabase/migrations/20260725202100_schema_rls_hook.sql#L229-L231); `routes`, `seat_locks`, `seat_lock_seats` have **no policy at all**; `companies` is status-scoped, not company-scoped | Operator B can read operator A's buses (plate numbers, layouts) via PostgREST. Tenant isolation for operators is enforced **inside the RPCs**, not by RLS as §5 claims. The isolation gate test [operator.test.ts:305](tests/db/operator.test.ts#L305) tests the RPC paths, and one `trips` select — not `buses` | **FIX DOC** (state that isolation is RPC-enforced) — buses-are-public is intentional (the seat map needs `layout`) |
| **`app_config` keys** | §8:231-233 names 5 keys | 6 exist: 4 in [init:24-28](supabase/migrations/20260725141239_init_config_and_enums.sql#L24-L28) + 2 in [booking_rpcs:45-48](supabase/migrations/20260727120000_booking_rpcs.sql#L45-L48). All 6 are **read**, none hardcoded: `lock_ttl_minutes` [locking:226](supabase/migrations/20260726135700_seat_map_and_locking.sql#L226), `cancel_window_hours` [:605](supabase/migrations/20260727120000_booking_rpcs.sql#L605), `max_active_bookings_per_user` [:306](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L306), `max_active_bookings_per_phone_per_trip` [:321](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L321), `lookup_rate_limit_max` + `_window_minutes` [:693-696](supabase/migrations/20260727120000_booking_rpcs.sql#L693-L696) | **Clean — no hardcoded literals.** §8 omits `lock_ttl_minutes` from its list | **FIX DOC** |
| **Lock TTL source** | §3:125 "Lock TTL: 10 minutes" | Read from `app_config.lock_ttl_minutes` [:226](supabase/migrations/20260726135700_seat_map_and_locking.sql#L226), value `10`. Frontend countdown derives from server `expiresAt` [store.ts:14-15](src/features/booking/store.ts#L14-L15) | none | — |
| **Cancel policy text** | §2 `cancellationPolicy` field | Hardcoded Arabic literal in `get_trip` [:49](supabase/migrations/20260727170500_get_trip_accepts_text_id.sql#L49); the "ساعتين" in it duplicates `cancel_window_hours=2`. Changing the config key silently desyncs the prose | Low; a config change makes the UI lie | **FIX CODE** (or document as display-only) |
| **Gender rules** | §0:15, §3:105, `CLAUDE.md`: enum on every passenger, on locked+booked seats only, default `male`, sent with lock, read-only at checkout | ✅ All four hold: enum [init:7](supabase/migrations/20260725141239_init_config_and_enums.sql#L7); map key absent on available [:60-64](supabase/migrations/20260726141549_get_seat_map_envelope.sql#L60-L64); default `male` [store.ts:53](src/features/booking/store.ts#L53); `create_booking` enforces gender == lock's gender [:248-264](supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql#L248-L264); checkout renders it read-only [checkout/page.tsx:150](src/app/booking/checkout/page.tsx#L150) | none | — |
| **`create_bus` layout immutability** | §5:181 "layout immutable once bus has published trips (**409**)" | `update_bus` returns `VALIDATION_ERROR` [:706](supabase/migrations/20260727160000_operator_rpcs.sql#L706). There is no `CONFLICT` code in §0, so `VALIDATION_ERROR` is the only legal choice | Doc uses HTTP vocabulary the envelope does not have | **FIX DOC** |
| **`get_manifest` payment status** | §5:177 "payment status" | Derived as `checked_in_at is not null ? 'paid' : 'unpaid'` [:329](supabase/migrations/20260727160000_operator_rpcs.sql#L329). There is **no payment column** in the schema. Check-in is being reported as payment | An operator reading the manifest sees "unpaid" for a passenger who paid but has not boarded | **FIX DOC** (or add the column) |
| **`check_in` response shape** | §5:178 (and B5 prompt) "returns `{booking, passenger}`" | Returns `passengers` **array** — one QR per booking, N passengers. Flagged in the migration's own header [:64-70](supabase/migrations/20260727160000_operator_rpcs.sql#L64-L70) | none yet (no consumer) | **FIX DOC** |
| **Admin surface** | §6 documents 4 admin capabilities incl. 2 RPCs | **Nothing exists.** No admin migration, no admin test, no admin route | §6 is entirely aspirational; 2 P0 test cases depend on it | **FIX CODE** |
| **Companies table read** | §2:53 `companies.select()` → `{id, name, logo_url, rating, tripsCount}` | No `tripsCount` column exists [schema:30-39](supabase/migrations/20260725202100_schema_rls_hook.sql#L30-L39). `/companies/[slug]` still reads `@/mocks/data` [companies/[slug]/page.tsx:3](src/app/(public)/companies/[slug]/page.tsx#L3) | Latent — no real consumer | **FIX DOC** |
| **Seed vs `src/mocks/data.ts`** | Seed header: "Mirrors `src/mocks/data.ts`" | ✅ Same city/company/trip UUIDs, same 12×4 aisleAfterCol 2 layout, same 12 tomorrow trips, same departed (n=13) / full (n=14) fixtures. **busType matches on all 14** (verified bus-id → type mapping). **Differences:** (a) `availableSeats` is hand-picked in the mock (5…40) but derived from real rows in DEV (48 everywhere except n=14); (b) seed adds company 4 `pending`, trip 15 `draft`, and 13 days × 6 templates of extra trips — mock has none; (c) seed adds 5 auth accounts | Manual QA cases that assert a specific seat count (e.g. "38 مقعد") pass on MSW and fail on DEV | **FIX DOC** (QA_PHASE_B_MANUAL expectations) |
| **`NEXT_PUBLIC_USE_MOCKS` default** | not documented | Defaults to `"true"` when unset [env.ts:4](src/config/env.ts#L4) | A deploy target that forgets the var silently ships MSW to production | **FIX CODE** |
| **Task 15 hardening** | `FRONTEND_REMAINING.md` PART 2 item 1: replace the 400ms mount guard with `pagehide` | **Not done** — [checkout/page.tsx:43-55](src/app/booking/checkout/page.tsx#L43-L55) still uses `Date.now() - mountedAt > 400` and `beforeunload` | Lock not released on iOS Safari tab close → seat held for the full TTL | **FIX CODE** |
| **Task 15 audits** | PART 3 items 3, 6, 8: zero HTTP-status hits, no `pl-/pr-` outside `components/ui`, no hardcoded Arabic | ✅ All three pass: 8 `status ===` hits are all **domain** fields (`seat.status`, `booking.status`, realtime channel status), 0 physical-direction classes, 1 Arabic literal is the `"، "` list separator inside a `t()` interpolation [seat-selection.tsx:59](src/features/booking/components/seat-selection.tsx#L59) | none | — |
| **`generate_pnr` / `custom_access_token_hook` privilege** | `CLAUDE.md`: "All RPCs: `SECURITY DEFINER`, `SET search_path = public`" | `generate_pnr` [:102-104](supabase/migrations/20260727120000_booking_rpcs.sql#L102-L104) and `custom_access_token_hook` [:150-152](supabase/migrations/20260725202100_schema_rls_hook.sql#L150-L152) are **not** `security definer` | Neither needs it (`generate_pnr` touches no table; the hook runs as `supabase_auth_admin` which is granted `select on profiles`). Contract statement is over-broad | **FIX DOC** |
| **`alter default privileges`** | not documented | [service_role_grants.sql](supabase/migrations/20260726100000_service_role_grants.sql) grants service_role EXECUTE on every future function; B7 revokes 3 by hand and flags the systemic issue itself [:26-30](supabase/migrations/20260727170000_b7_grants_hardening.sql#L26-L30) | Every new internal helper needs its own revoke or leaks to service_role | **FIX CODE** (out of B7 scope by its own note) |

---

## STEP 4 — Runnability

### 4.1 What is already fine (verified live, do not re-do)

| item | status |
|---|---|
| `.env.local` present with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ |
| `.env.test` present with URL / anon / **service_role** / DB password / 4 test credentials | ✅ |
| Anonymous sign-ins **enabled** on hosted DEV | ✅ `POST /auth/v1/signup {}` → 200 + `is_anonymous:true`, `user_role:passenger` |
| Email password login for seeded operator + admin | ✅ 200; claims `user_role=operator, company_id=000000a1-…-003` / `user_role=admin`, no `company_id` |
| Custom access token hook wired on DEV | ✅ (claims above prove it) |
| Vault `qr_hmac_secret` on DEV | ✅ implied — `create_booking` is live and would raise without it; **UNVERIFIED directly** (no read path from outside) |
| Seed applied on DEV | ✅ `search_trips(damascus, aleppo, 2026-07-29, 1)` returns the seeded الأمانة trip, `availableSeats: 48` |
| `src/types/database.ts` fresh **relative to DEV** | ✅ `supabase gen types --linked` → **byte-identical**, 0-line diff (regenerated to scratchpad, tracked file untouched) |
| `npx tsc --noEmit` | ✅ exit 0 |
| Live `lock_seats` → `release_lock` round trip as an anonymous session | ✅ `{ok:true, lockId, expiresAt}` then `{ok:true, data:null}` (test lock released) |

### 4.2 Blockers, each with the exact fix

| # | Blocker | Exact command / setting |
|---|---|---|
| **B1** | **5 migrations are untracked and unapplied to DEV.** Live probe: `trip_seat_map_version` → `PGRST205`; `get_manifest`/`check_in`/`create_bus`/`operator_summary`/`role_executable_functions`/`anon_executable_functions` → `PGRST202`; `get_trip('not-a-uuid')` → `22P02` (uuid overload still live) | `git add supabase/migrations/2026072715* supabase/migrations/2026072716* supabase/migrations/2026072717* supabase/migrations/20260728100000_* tests/db/operator.test.ts tests/db/security.test.ts tools/load` then `npm run db:whoami` (confirm `LINKED=gidodxojpvztrsihnqxj`) then `npm run db:reset` |
| **B2** | **`npm run db:reset` and `db:types` cannot use the direct Postgres port from this machine.** `supabase migration list --linked` → `LegacyDbConnectError: Connection timed out`. (`gen types --linked` works — it uses the Management API.) | Either run the reset from a network that reaches the DEV Postgres host (README notes DEV resolves IPv6-only), or apply via the dashboard SQL editor — which `CLAUDE.md` forbids. **This is the hard blocker on B1.** |
| **B3** | **`src/types/database.ts` will go stale the moment B1 lands.** It currently matches DEV exactly, but DEV is behind the repo. Missing once applied: table `trip_seat_map_version`, functions `create_trip, update_trip, cancel_trip, get_manifest, check_in, check_in_by_pnr, operator_cancel_booking, create_bus, update_bus, operator_summary, operator_trip_json, check_in_booking, role_executable_functions, bump_seat_map_version` | `npm run db:types` after B1. **Expected diff: ~+120 lines** (1 table block + 14 function entries, minus the dropped `anon_executable_functions`). Reported, not committed. |
| **B4** | **`NEXT_PUBLIC_USE_MOCKS=true` in `.env.local`** | Set `NEXT_PUBLIC_USE_MOCKS=false` in `.env.local` |
| **B5** | **`src/features/booking/api.ts` targets axios `/api/*`; there are no Next route handlers** (`src/app` has no `api/` dir, `next.config.ts` has no rewrites) | Task E3: rewrite all four functions onto `callRpc` |
| **B6** | **No `signInAnonymously()` call** | Task E3: ensure a session before the first `lock_seats` |
| **B7** | No PROD project, no PROD Vault secret, no backup-restore drill | Pre-launch checklist in README — out of scope for DEV |

### 4.3 Verdict

> **Can `npm run dev` with `NEXT_PUBLIC_USE_MOCKS=false` complete search → seat map → lock → booking today?**
>
> ## NO.

| step | result |
|---|---|
| `/search` (cities + `search_trips`) | ✅ works — real RPC, verified live |
| `/trips/[id]` (`get_trip`) | ✅ works for a well-formed id. A malformed id renders the generic error card, not the not-found card (the `get_trip(text)` fix is unapplied) |
| **seat map** | ❌ **FIRST FAILING STEP.** [use-seat-map.ts:108](src/features/booking/hooks/use-seat-map.ts#L108) → [booking/api.ts:19](src/features/booking/api.ts#L19) → `axios.get("/api/trips/:id/seats")`. With mocks off, `mocksReady()` resolves immediately [init.ts:16-18](src/mocks/init.ts#L16-L18), MSW never starts, and Next has no `/api` route → 404 → axios throws → `isError` → `<p>{t("loadError")}</p>` [seat-selection.tsx:94](src/features/booking/components/seat-selection.tsx#L94). **The seat map never renders.** |
| lock / checkout / booking | ❌ unreachable |

Everything below the seat map is blocked by one file. The database side of all three steps is live and working (proved by the `lock_seats`/`release_lock` round trip).

---

## STEP 5 — Test readiness vs `docs/V1_TEST_PLAN.md`

**Suites are not run in this audit** (`npm run db:test` targets hosted DEV and `resetDb`/`db:reset` are destructive). "Passes?" is a static judgement from the code + the live schema probe.

### 5.1 P0 `[AUTO]` matrix — all 28

| Test ID | exists in `tests/db`? | status | passes? | blocked by |
|---|---|---|---|---|
| T-PAS1-6 | [catalog.test.ts:70](tests/db/catalog.test.ts#L70), [:96](tests/db/catalog.test.ts#L96); [rls.test.ts:41](tests/db/rls.test.ts#L41) | **PARTIAL** | likely | no assertion that a `draft` trip is absent from `search_trips` **output** (only from the table read) |
| T-PAS4-8 | [concurrency.test.ts:296](tests/db/concurrency.test.ts#L296) | **IMPLEMENTED** | likely | — |
| T-LOCK-1 | [concurrency.test.ts:58](tests/db/concurrency.test.ts#L58) | **IMPLEMENTED** | likely | anon sign-in pool (30/h/IP on DEV) — `pooledAnonClient` [helpers.ts:209](tests/db/helpers.ts#L209) exists for this |
| T-LOCK-2 | [concurrency.test.ts:78](tests/db/concurrency.test.ts#L78) | **IMPLEMENTED** | likely | — |
| T-LOCK-3 | [concurrency.test.ts:240](tests/db/concurrency.test.ts#L240), [:279](tests/db/concurrency.test.ts#L279), [:327](tests/db/concurrency.test.ts#L327) | **IMPLEMENTED** (was the STATE_REPORT's #1 gap) | likely | — |
| T-LOCK-4 | [concurrency.test.ts:113](tests/db/concurrency.test.ts#L113) | **IMPLEMENTED** | likely | — |
| T-LOCK-5 | [concurrency.test.ts:130](tests/db/concurrency.test.ts#L130) + [:147](tests/db/concurrency.test.ts#L147) | **IMPLEMENTED** (idempotent-release case now present) | likely | — |
| T-LOCK-6 | [concurrency.test.ts:171](tests/db/concurrency.test.ts#L171) | **IMPLEMENTED** | likely | — |
| T-PAS6-7 | [booking.test.ts:174](tests/db/booking.test.ts#L174) | **IMPLEMENTED** | likely | — |
| T-PAS6-9 | [booking.test.ts:218](tests/db/booking.test.ts#L218) | **IMPLEMENTED** | likely | — |
| T-PAS6-10 | [booking.test.ts:341](tests/db/booking.test.ts#L341), [:358](tests/db/booking.test.ts#L358), [:368](tests/db/booking.test.ts#L368) | **IMPLEMENTED** (all 3 cases) | likely | — |
| T-PAS6-12 | [booking.test.ts:389](tests/db/booking.test.ts#L389) | **IMPLEMENTED** | likely | — |
| T-PAS6-13 | [booking.test.ts:568](tests/db/booking.test.ts#L568) + [:585](tests/db/booking.test.ts#L585) | **IMPLEMENTED** (both ceilings) | likely | — |
| T-PAS7-2 | [booking.test.ts:616](tests/db/booking.test.ts#L616) (×200) | **IMPLEMENTED** | likely | — |
| T-PAS8-2 | [booking.test.ts:669](tests/db/booking.test.ts#L669) | **IMPLEMENTED** | likely | — |
| T-PAS10-3 | [booking.test.ts:745](tests/db/booking.test.ts#L745) + [rls.test.ts:62](tests/db/rls.test.ts#L62) | **IMPLEMENTED** | likely | — |
| T-PAS11-2 | [booking.test.ts:809](tests/db/booking.test.ts#L809) (byte-identical) | **IMPLEMENTED** | likely | — |
| T-OPR1-2 *(launch blocker)* | [operator.test.ts:305](tests/db/operator.test.ts#L305), [:323](tests/db/operator.test.ts#L323), [:332](tests/db/operator.test.ts#L332), [:340](tests/db/operator.test.ts#L340), [:352](tests/db/operator.test.ts#L352) | **IMPLEMENTED** | ❌ **FAILS on DEV today** | operator RPCs not applied (`PGRST202`) → **B1/B2** |
| T-OPR2-2 | [operator.test.ts:420](tests/db/operator.test.ts#L420) | **IMPLEMENTED** | ❌ on DEV | B1/B2 |
| T-OPR3-3 | [operator.test.ts:509](tests/db/operator.test.ts#L509), [:527](tests/db/operator.test.ts#L527), [:534](tests/db/operator.test.ts#L534) | **IMPLEMENTED** | ❌ on DEV | B1/B2 |
| T-ADM1-2 | — | **MISSING** | — | no `set_company_status` RPC exists (§6) |
| T-ADM-SEC | — | **MISSING** | — | no admin RPCs exist |
| T-SEC-1 | [security.test.ts:93](tests/db/security.test.ts#L93), [:107](tests/db/security.test.ts#L107), [:117](tests/db/security.test.ts#L117), [:134](tests/db/security.test.ts#L134), [:149](tests/db/security.test.ts#L149) | **IMPLEMENTED** (set-equality, incl. service_role surface) | ❌ on DEV | `role_executable_functions` not applied → B1/B2 |
| T-SEC-2 | [rls.test.ts:93](tests/db/rls.test.ts#L93), [:108](tests/db/rls.test.ts#L108), [:134](tests/db/rls.test.ts#L134), [:184](tests/db/rls.test.ts#L184) | **IMPLEMENTED** (trips, bookings, seat_locks, companies — all 4) | likely | — |
| T-SEC-3 | [rls.test.ts:41](tests/db/rls.test.ts#L41), [:50](tests/db/rls.test.ts#L50), [:62](tests/db/rls.test.ts#L62), [:77](tests/db/rls.test.ts#L77), [:84](tests/db/rls.test.ts#L84) | **IMPLEMENTED** (profiles gap closed) | likely | — |
| T-SEC-5 | [envelope.test.ts:43](tests/db/envelope.test.ts#L43) | **PARTIAL** | likely | only `get_trip` + `get_seat_map` are swept; "every failure path exercised above" is asserted case-by-case, never systematically |
| T-PERF-1 | [tools/load/seat-map.js](tools/load/seat-map.js) | **IMPLEMENTED (unrun)** | UNVERIFIED | k6 not installed/run; no result recorded anywhere |
| T-PERF-2 | [tools/load/lock-seats.js](tools/load/lock-seats.js) | **IMPLEMENTED (unrun)** | UNVERIFIED | k6 not run; DEV caps anon sign-ins at ~30/h/IP (script defaults to 20 sessions) |

**Score: 23 IMPLEMENTED · 3 PARTIAL · 2 MISSING.** Of the 23, **4 cannot pass against DEV today** purely because of B1.

Bonus P1 `[AUTO]` also implemented: T-PAS3-4 [catalog.test.ts:203](tests/db/catalog.test.ts#L203)/[:209](tests/db/catalog.test.ts#L209), T-PAS1-7 [:109](tests/db/catalog.test.ts#L109), T-PAS1-8 [:396](tests/db/catalog.test.ts#L396), T-LOCK-10 [concurrency.test.ts:184](tests/db/concurrency.test.ts#L184), T-PAS6-14 [booking.test.ts:534](tests/db/booking.test.ts#L534), T-PAS8-4 [:706](tests/db/booking.test.ts#L706), T-PAS11-3 [:830](tests/db/booking.test.ts#L830), T-RES-5 [:866](tests/db/booking.test.ts#L866), T-OPR3-6 [operator.test.ts:305+](tests/db/operator.test.ts#L305), T-OPR4-1 [:619](tests/db/operator.test.ts#L619), T-OPR5-1 [:677](tests/db/operator.test.ts#L677). **T-ADM2-1 is MISSING.**

### 5.2 Manual cases — unblockable today vs blocked

| Unblockable **today** (frontend already on real data) | Blocked, and by what |
|---|---|
| T-PAS1-1..5 (search form, date picker, empty state, URL round-trip) | **T-PAS4-1..7** (seat map render, gender icons, selection cap, gender toggle, refetch survival, 2-device seat drop) — **B4/B5** |
| T-PAS2-1..6 (filters, sort, URL restore, mobile Sheet) | **T-LOCK-7, T-LOCK-8, T-LOCK-9** — B4/B5/B6; T-LOCK-7 additionally needs `npx tsx tools/qa/prelock-seat-13.ts` |
| T-PAS3-1 (trip details), **T-PAS3-2** (departed CTA), **T-PAS3-3** (full CTA) — the seeded n=13/n=14 fixtures are live on DEV | **T-PAS5-1..3** (countdown, destructive style, expiry dialog) — B4/B5/B6; T-PAS5-3 needs `tools/qa/shorten-lock.ts` |
| T-SEC-4 (network tab: only anon key shipped) | **T-PAS6-1..6, -8, -11** (checkout) — B4/B5/B6 |
| T-RTL-1..3 (RTL sweep, ar.json, number/date formatting) — all screens exist | **T-PAS7-1, -3, -4, -5** (ticket confirmation) — B4/B5/B6 |
| T-PERF-3, T-PERF-4 (LCP, layout shift) | **T-PAS8-1, -3** (cancel UX) — no cancel UI exists at all |
| T-DEV-1 partially (search+details on all devices) | **T-PAS10-1, -2, T-PAS11-1, -4** — `/tickets` and `/tickets/lookup` routes do not exist (Task E4) |
| — | **T-OPR0-1..3, T-OPR1-1, T-OPR2-1, -3, T-OPR3-1, -2, -4, -5, T-OPR4-1** — `/operator` is a 12-line placeholder [page.tsx:3](src/app/(public)/operator/page.tsx#L3); Phase D not started |
| — | **T-ADM1-1, T-ADM3-1** — no admin UI, no admin RPCs |
| — | **T-RES-1..4** — depend on the real booking path |

---

## STEP 6 — Remaining to v1

### 6.1 Ordered backlog to the §11 launch gate

| # | Item | Layer | Size | Blocks | Blocked by |
|---|---|---|---|---|---|
| 1 | Restore Postgres connectivity to DEV (`migration list --linked` currently times out) | infra | S | 2 | network / IPv6 route to DEV host |
| 2 | Commit + apply the 5 pending migrations (`db:reset` against DEV) | be | S | 3,4,7,9 | 1 |
| 3 | `npm run db:types` + commit (~+120 lines) | be | S | 5 | 2 |
| 4 | Green `npm run db:test` on DEV incl. `operator.test.ts` + `security.test.ts` | tests | S | 15 | 2 |
| 5 | **Task E3** — booking `api.ts` → `callRpc`, remove booking MSW handlers | fe | M | 6,8,10,11 | 3 |
| 6 | `signInAnonymously()` before first lock (+ session guard) | fe | S | 8,10 | 5 |
| 7 | Admin RPCs (§6): `set_company_status`, `commissions_by_month`, city/route delete guard | be | M | 12,13 | 2 |
| 8 | Frontend cutover QA on DEV: happy path · 2-browser conflict · LOCK_EXPIRED via `tools/qa` · double-tap idempotency · cross-browser gender | fe | M | 15 | 5,6 |
| 9 | Fix `busType` (enum/CHECK) + `buses.layout` shape CHECK — both currently able to blank a whole page | be | S | — | 2 |
| 10 | **Task E4** — `/tickets`, `/tickets/[id]`, `/tickets/lookup` + `cancel_booking` UI | fe | M | 15 | 5,6 |
| 11 | Task 15 leftovers: `pagehide` release, `NEXT_PUBLIC_USE_MOCKS` default flip | fe | S | — | 5 |
| 12 | Admin tests: T-ADM1-2, T-ADM-SEC, T-ADM2-1 | tests | S | 15 | 7 |
| 13 | **Phase D — operator portal** (login, trips list, CRUD, manifest, QR scanner, buses, reports) | fe | **L** | 15 | 2,7 |
| 14 | Admin portal UI (bookings overview, commissions) | fe | M | 15 | 7 |
| 15 | Run k6 T-PERF-1/2 on staging-sized data; record results | tests | S | 18 | 4 |
| 16 | Reconcile `BACKEND_V1.md` §1/§3/§4/§5/§6/§8 with this document's drift table | — | M | — | — |
| 17 | Add `tests/unit/**` + `vitest.config.ts` to the CI `web` path filter and run `npm test` (currently never executes) | infra | S | 18 | — |
| 18 | PROD project · migrations up · manual Vault secret · rotated creds · T-SEC-1 re-run on prod · backup-restore drill | infra | **L** | launch | 13,14,15 |
| 19 | Full P0 manual suite on staging incl. both MAN×2-device cases (T-LOCK-8, T-PAS7-5) | tests | M | launch | 8,10,13 |
| 20 | 5 consecutive green CI runs, zero flakes | tests | S | launch | 4,12 |

### 6.2 Completion by layer

| layer | % | one-line reasoning |
|---|---|---|
| **Frontend** | **55%** | Search + trip details are fully on Supabase and complete; the entire seat/lock/checkout/ticket path is still MSW-only; `/tickets`, `/tickets/lookup`, cancel UI, operator portal and admin portal do not exist. |
| **Backend** | **80%** | §1–§5 are fully implemented, contract-clean on codes and casing, and defensively written (advisory locks, FOR UPDATE, partial unique index, byte-identical NOT_FOUND) — but §6 Admin is 0% and 5 migrations are neither committed nor applied. |
| **Tests** | **75%** | 23 of 28 P0 `[AUTO]` implemented across 10 db suites (~110 `it()`), plus both k6 scripts written; missing only the 2 admin cases and 3 partials, and k6 has never been executed. |
| **Infra** | **35%** | CI runs a full local stack and gates types-freshness, and DEV is seeded and reachable — but there is no PROD project, no PROD Vault secret, no restore drill, no deploy target, the unit suite never runs in CI, and the DEV Postgres port is unreachable from the dev machine. |

### 6.3 Critical path (single chain)

> **DEV Postgres reachable** → **apply 5 migrations** → **`db:types` committed** → **E3 booking cutover + `signInAnonymously`** → **cutover QA on DEV (2-browser conflict, LOCK_EXPIRED, idempotency)** → **E4 tickets + PNR lookup** → **admin RPCs (§6)** → **Phase D operator portal** → **P0 manual suite + k6 on staging** → **5× green CI** → **PROD project + Vault + restore drill** → **§11 launch gate**

The first link is the one that is stuck: everything backend-side is written and everything frontend-side after step 3 is blocked on one 44-line file.

### 6.4 Top 5 risks

| # | Risk | Concrete symptom if it bites |
|---|---|---|
| 1 | **The 5 pending migrations have never run against any database.** `20260727150000` (FOR UPDATE row lock), `20260727160000` (837 lines of operator RPCs), `20260727170000`, `20260727170500`, `20260728100000` exist only as files. | `npm run db:reset` fails partway through migration 8 of 13; DEV is left half-migrated with the seed unapplied; `search_trips` starts returning `[]` and every QA session on DEV stops until someone reconstructs the drop order for `get_trip(uuid)` and `anon_executable_functions()`. |
| 2 | **`create_booking` on DEV lacks the FOR UPDATE row lock** (the fix in `20260727150000`, unapplied). Any real double-submit today races through the pre-checks. | A passenger double-taps تأكيد الحجز with a regenerated idempotency key, gets `SEAT_ALREADY_BOOKED`, is sent back to the seat map, and books a **second set of seats** — two confirmed tickets, two cash payments at the office, one angry operator. Exactly the failure the migration header describes. |
| 3 | **`buses.bus_type` is unconstrained `text` and `buses.layout` is unconstrained `jsonb`, while zod requires `["عادي","VIP"]` and `{rows,cols,aisleAfterCol}`.** `create_bus` validates the layout but nothing guards the column. | An operator creates a bus with `bus_type = "مكيف"` (or a layout missing `aisleAfterCol`) via any path that is not `create_bus`; `tripSearchListSchema.parse()` throws on the whole array and **`/search` renders the error state for every route that company runs** — not one broken card, the entire page. |
| 4 | **§5 claims tenant isolation is RLS; it is actually enforced inside the RPCs, and `buses` is `using (true)` for anon.** | Someone builds a Phase D operator screen that reads `supabase.from("buses").select()` directly, trusting §5, and ships a page where operator A sees operator B's fleet — plate numbers and layouts — with no test failing, because [operator.test.ts:332](tests/db/operator.test.ts#L332) only covers the `update_bus` RPC path. |
| 5 | **`NEXT_PUBLIC_USE_MOCKS` defaults to `"true"` when unset** [env.ts:4](src/config/env.ts#L4), and no deploy target is configured yet. | The first production deploy forgets the env var; the site boots, MSW registers its service worker, and users search real routes but book against `src/mocks/data.ts` — receiving PNRs that exist in no database, on a page that looks entirely healthy. |

---

## APPENDIX A — raw inventory output

### `git log --oneline -50`
```
4e93151 fix: create_booking single-snapshot lock read; nullable company fields; thread passengers
1d065b5 feat: B4 - booking, idempotency, lookup, limits
81ffe6a fix(ci): compare db types on schema content, ignore generator preamble
bf7a2e9 chore: regenerate db types after B3
40744e9 fix(ci): email enable_signup also gates login on the local stack
89c9f60 fix(ci): align auth config, pin CLI version, add config guard
878ac4c fix(ci): align local stack auth config with the hosted dev dashboard
4109ef6 fix(ci): strip quotes from exported env; type test helpers
f938ac0 fix(ci): repair db job, trigger on workflow changes, allow manual dispatch
90699a4 fix(ci): export supabase env with the names helpers.ts reads
7613bc4 feat: B3 - seat map, locking, concurrency suite
e89bb39 feat: B3 - seat map, locking, concurrency suite
65e095d feat: B2 - catalog RPCs (search_trips, get_trip) + service_role grants
771c391 feat: B1 — schema, RLS, access token hook, seed
05adc50 feat: B0 — config, enums, test harness against DEV
14d3859 tasks frontend from 10 to 14
ead3370 chore: WIP snapshot before green-up
0b8f767 first commit
dc1543c Initial commit from Create Next App
```
(19 commits total — the repo has no more history.)

### `git status --short`
```
 M README.md
 M docs/BACKEND_V1.md
 M src/features/booking/hooks/use-seat-map.ts
 M tests/db/concurrency.test.ts
 M tests/db/rls.test.ts
?? supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql
?? supabase/migrations/20260727160000_operator_rpcs.sql
?? supabase/migrations/20260727170000_b7_grants_hardening.sql
?? supabase/migrations/20260727170500_get_trip_accepts_text_id.sql
?? supabase/migrations/20260728100000_realtime_seat_map_version.sql
?? tests/db/operator.test.ts
?? tests/db/security.test.ts
?? tools/load/
```
`git diff --stat`: `README.md +250/-…`, `docs/BACKEND_V1.md +2`, `use-seat-map.ts +100/-2`, `concurrency.test.ts +166`, `rls.test.ts +121` — 585 insertions, 56 deletions across 5 files.

### `ls -1 supabase/migrations/`
```
20260725141239_init_config_and_enums.sql                  (31 lines)
20260725202100_schema_rls_hook.sql                        (320)
20260726100000_service_role_grants.sql                    (17)
20260726125327_catalog_rpcs.sql                           (153)
20260726135700_seat_map_and_locking.sql                   (296)
20260726141549_get_seat_map_envelope.sql                  (83)
20260727120000_booking_rpcs.sql                           (727)
20260727130000_create_booking_lock_single_snapshot.sql    (404)
20260727150000_create_booking_row_lock_and_grants_audit.sql (497)  UNTRACKED
20260727160000_operator_rpcs.sql                          (837)   UNTRACKED
20260727170000_b7_grants_hardening.sql                    (93)    UNTRACKED
20260727170500_get_trip_accepts_text_id.sql               (107)   UNTRACKED
20260728100000_realtime_seat_map_version.sql              (140)   UNTRACKED
```

### `grep -rn "create or replace function" supabase/migrations/`
```
20260725202100_schema_rls_hook.sql:148:  public.custom_access_token_hook
20260726125327_catalog_rpcs.sql:18:      public.search_trips
20260726125327_catalog_rpcs.sql:87:      public.get_trip
20260726135700_seat_map_and_locking.sql:25:   public.get_seat_map
20260726135700_seat_map_and_locking.sql:106:  public.lock_seats
20260726135700_seat_map_and_locking.sql:268:  public.release_lock
20260726141549_get_seat_map_envelope.sql:6:   public.get_seat_map
20260727120000_booking_rpcs.sql:69:       public.qr_hmac_secret
20260727120000_booking_rpcs.sql:100:      public.generate_pnr
20260727120000_booking_rpcs.sql:131:      public.booking_ticket
20260727120000_booking_rpcs.sql:213:      public.create_booking
20260727120000_booking_rpcs.sql:570:      public.cancel_booking
20260727120000_booking_rpcs.sql:628:      public.get_booking
20260727120000_booking_rpcs.sql:676:      public.lookup_booking
20260727130000_create_booking_lock_single_snapshot.sql:28:  public.create_booking
20260727150000_create_booking_row_lock_and_grants_audit.sql:55:  public.create_booking
20260727150000_create_booking_row_lock_and_grants_audit.sql:475: public.anon_executable_functions
20260727160000_operator_rpcs.sql:30:      public.operator_trip_json
20260727160000_operator_rpcs.sql:71:      public.create_trip
20260727160000_operator_rpcs.sql:145:     public.update_trip
20260727160000_operator_rpcs.sql:224:     public.cancel_trip
20260727160000_operator_rpcs.sql:295:     public.get_manifest
20260727160000_operator_rpcs.sql:369:     public.check_in_booking
20260727160000_operator_rpcs.sql:435:     public.check_in
20260727160000_operator_rpcs.sql:497:     public.check_in_by_pnr
20260727160000_operator_rpcs.sql:544:     public.operator_cancel_booking
20260727160000_operator_rpcs.sql:598:     public.create_bus
20260727160000_operator_rpcs.sql:667:     public.update_bus
20260727160000_operator_rpcs.sql:753:     public.operator_summary
20260727170000_b7_grants_hardening.sql:59:  public.role_executable_functions
20260727170500_get_trip_accepts_text_id.sql:39: public.get_trip
20260728100000_realtime_seat_map_version.sql:45: public.bump_seat_map_version
```

### `ls -1 tests/db/` · `ls -1 tools/qa tools/load`
```
tests/db/: booking.test.ts(907) catalog.test.ts(408) claims.test.ts(93)
           concurrency.test.ts(346) envelope.test.ts(55) helpers.ts(287)
           operator.test.ts(737) rls.test.ts(220) security.test.ts(153) smoke.test.ts(37)
tests/unit/: envelope.test.ts
tools/qa/:   prelock-seat-13.ts  shorten-lock.ts
tools/load/: lock-seats.js  seat-map.js
```

### `package.json` scripts
```json
"dev": "next dev",
"build": "next build",
"start": "next start",
"lint": "eslint",
"test": "vitest run",
"format": "prettier --write .",
"db:whoami": "supabase projects list && node -e \"console.log('LINKED=' + require('fs').readFileSync('supabase/.temp/project-ref','utf8').trim())\"",
"db:reset": "dotenv -e .env.test -- cmd /c \"echo y| supabase db reset --linked\"",
"db:types": "dotenv -e .env.test -- supabase gen types typescript --linked > src/types/database.ts",
"db:test": "vitest run -c vitest.db.config.ts"
```

### `ls -R src/features src/app` (trimmed)
```
src/app: (public)/{companies/[slug],operator,search,trips/[id],page.tsx,layout.tsx}
         booking/{checkout,confirmation}  layout.tsx  globals.css
         — NO api/ directory
src/features/auth:    components/ (EMPTY)  hooks/ (EMPTY)
src/features/tickets: components/ (EMPTY)  hooks/ (EMPTY)
src/features/booking: api.ts schemas.ts store.ts
                      components/{booking-ticket,gender-icon,lock-countdown,order-summary,
                                  passenger-form,pnr-copy,seat-map,seat-selection,
                                  selection-bar,ticket-status-header}.tsx
                      hooks/use-seat-map.ts
src/features/search:  api.ts schemas.ts filter-trips.ts
                      components/{city-select,date-picker,form-field,passengers-select,
                                  popular-routes,search-filters-sheet,search-filters,
                                  search-form-schema,search-form,search-results,
                                  search-summary,trip-card,trip-detail-view,trip-detail}.tsx
                      hooks/{use-cities,use-search-trips,use-trip,use-trip-filters}.ts
```

### `grep -rn "NEXT_PUBLIC_USE_MOCKS\|useMocks" src/`
```
src/config/env.ts:4:   NEXT_PUBLIC_USE_MOCKS: z.enum(["true","false"]).default("true"),
src/config/env.ts:11:  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS,
src/mocks/init.ts:3:   const mocksEnabled = env.NEXT_PUBLIC_USE_MOCKS === "true";
src/providers/mock-provider.tsx:7: (comment)
```

### `grep -rn "callRpc\|supabase.rpc\|supabase.from" src/features/ src/lib/`
```
src/features/search/api.ts:4   import { callRpc, callRpcBare } from "@/lib/rpc";
src/features/search/api.ts:75  callRpcBare(browserClient(), "search_trips", {p_from_slug,p_to_slug,p_travel_date,p_passengers}, …)
src/features/search/api.ts:95  callRpc(browserClient(), "get_trip", {p_trip_id: id}, tripDetailSchema)
src/features/search/api.ts:28  browserClient().from("cities").select("id,name_ar,name_en,slug")
src/lib/rpc.ts:53              client.rpc(name, args)   // callRpc
src/lib/rpc.ts:70              client.rpc(name, args)   // callRpcBare
```
**`src/features/booking/` has ZERO hits.**

### `grep -rn "from \"axios\"\|api-client" src/features/`
```
src/features/booking/api.ts:3  import { api } from "@/lib/api-client";
src/lib/api-client.ts:1        import axios from "axios";   // axios.create({ baseURL: "/api" })
```

### `ls -1 src/mocks/` · `wc -l src/types/database.ts`
```
browser.ts(5)  data.ts(442)  handlers.ts(256)  init.ts(20)
MSW routes still registered: GET /api/trips/:id/seats · POST /api/trips/:id/seats/lock
                             POST /api/locks/:lockId/release · POST /api/bookings
                             POST /api/bookings/lookup   (cities/search/trip handlers already removed)
635 src/types/database.ts
```

### Live probes against hosted DEV (2026-07-28)
```
GET  /rest/v1/cities?select=slug                          → 200
GET  /rest/v1/trip_seat_map_version?select=trip_id        → PGRST205 (table not in schema cache)
POST /rest/v1/rpc/search_trips {damascus,aleppo,…}        → [ …seeded trips, availableSeats:48 ]
POST /rest/v1/rpc/get_trip {"p_trip_id":"not-a-uuid"}     → 22P02 invalid input syntax for type uuid
POST /rest/v1/rpc/get_seat_map {seeded trip}              → {"ok":true,"data":{seats:[…48…]}}
POST /rest/v1/rpc/lock_seats (no session)                 → {"ok":false,"error":{"code":"UNAUTHORIZED",…}}
POST /rest/v1/rpc/get_manifest                            → PGRST202 (function not found)
POST /rest/v1/rpc/operator_summary                        → PGRST202
POST /rest/v1/rpc/check_in                                → PGRST202
POST /rest/v1/rpc/create_bus                              → PGRST202
POST /rest/v1/rpc/role_executable_functions               → PGRST202
POST /rest/v1/rpc/anon_executable_functions               → PGRST202
POST /auth/v1/signup {}                                   → 200  user_role=passenger, is_anonymous=true
POST /auth/v1/token?grant_type=password (operator)        → 200  user_role=operator, company_id=…a1…003
POST /auth/v1/token?grant_type=password (admin)           → 200  user_role=admin, no company_id
POST /rest/v1/rpc/lock_seats (anon session, seat 41)      → {"ok":true,"data":{lockId,expiresAt}}
POST /rest/v1/rpc/release_lock                            → {"ok":true,"data":null}   (test lock released)
supabase migration list --linked                          → LegacyDbConnectError: connection timed out
supabase gen types typescript --linked                    → OK, 635 lines, 0-byte diff vs committed
npx tsc --noEmit                                          → exit 0
```
