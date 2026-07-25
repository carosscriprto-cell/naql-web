# Backend Requirements — v1 (Supabase Edition)

**Stack decision (locked, replaces custom ASP.NET plan):** Supabase — Postgres 15 + PostgREST + Supabase Auth + Realtime. All critical logic lives in **Postgres RPC functions (plpgsql)**, never in the client.

Audience: backend team + frontend. This is the data/RPC contract the frontend is built against (currently mocked with MSW using these exact shapes — MSW stays until Phase E). Any change to shapes below must be agreed before implementation.

---

## 0. Global Conventions

- **Access:** frontend uses `@supabase/supabase-js`. Reads go through PostgREST (RLS-protected). Critical writes go through `supabase.rpc()` only.
- **Datetimes:** ISO 8601 UTC (`timestamptz`). Frontend handles timezone display.
- **Money:** integers, SYP. Never floats. `{ "price": 85000, "currency": "SYP" }`
- **IDs:** UUID strings.
- **Gender:** enum `male | female` — on every passenger, and surfaced on the seat map (locked + booked seats).
- **RPC envelope (every critical-write RPC returns jsonb):**

```json
// success
{ "ok": true, "data": { ... } }
// failure (expected domain errors — NOT exceptions)
{ "ok": false, "error": { "code": "SEAT_ALREADY_LOCKED", "message": "Seat 12 was just taken", "details": { "seats": ["12"] } } }
```

`code` is a stable machine-readable enum — frontend builds UX on it. `features/*/api.ts` unwraps the envelope and throws a typed `ApiError` carrying `code`, so **all existing code-driven error handling in the frontend survives unchanged**. Known codes for v1:
`VALIDATION_ERROR · UNAUTHORIZED · FORBIDDEN · NOT_FOUND · SEAT_ALREADY_LOCKED · SEAT_ALREADY_BOOKED · LOCK_EXPIRED · TRIP_DEPARTED · IDEMPOTENCY_CONFLICT · CANCEL_WINDOW_CLOSED · BOOKING_LIMIT_REACHED`
(OTP codes removed — passenger OTP is v1.1.)

---

## 1. Auth

**No passenger login in v1.** Implementation = Supabase Auth, two modes:

- **Passengers = anonymous sessions.** `signInAnonymously()` on first lock attempt → every visitor has an `auth.uid()`. Locks and bookings bind to it; رحلاتي is RLS `user_id = auth.uid()`. Cross-device retrieval via `lookup_booking(pnr, phone)` (§4) — no account needed. Phone per passenger (collected at checkout) is the contact identity; operators call to confirm, per current market behavior.
- **Operators/admins = email + password.** Accounts created by admin (no self-signup). `profiles(id → auth.users, role, company_id?)`; a **Custom Access Token Hook** injects `role` (`operator|admin`) and `company_id` into JWT claims → used by RLS.
- **v1.1 upgrade path (designed now, built later):** passenger phone OTP via anonymous **identity linking** — guest bookings carry over to the account with zero schema changes. Do not build in v1.
- **Anti-abuse (replaces the friction OTP provided):** `create_booking` enforces max active future bookings per `auth.uid()` and per phone per trip (config values) → `BOOKING_LIMIT_REACHED`. `lookup_booking` is rate-limited against PNR/phone enumeration. Operator can cancel no-shows from the manifest (§5).

## 2. Catalog

Reads via PostgREST + one search RPC.

```
supabase.from("cities").select()                    → [{ id, nameAr, nameEn, slug }]
supabase.from("companies").select().eq("slug", s)   → { id, name, logoUrl, rating, tripsCount }
supabase.rpc("search_trips", { from_slug, to_slug, travel_date, passengers })
supabase.rpc("get_trip", { trip_id })
```

`search_trips` item shape (frontend renders exactly this — unchanged from before):
```json
{
  "id": "uuid",
  "company": { "id": "uuid", "name": "الأمانة", "logoUrl": "...", "rating": 4.6 },
  "fromCity": { "id": "...", "nameAr": "دمشق" },
  "toCity":   { "id": "...", "nameAr": "حلب" },
  "departureAt": "2026-07-10T08:30:00Z",
  "arrivalAt":   "2026-07-10T13:00:00Z",
  "price": 85000,
  "currency": "SYP",
  "availableSeats": 32,
  "busType": "VIP"
}
```
- `travel_date` is the departure date in **local Syria time**; the RPC converts to a UTC window (`Asia/Damascus`).
- Only `status = 'published'`, `departureAt > now()`, company `status = 'approved'` (checked at query time — suspension takes effect immediately).
- `availableSeats` = capacity − active bookings − unexpired locks, computed in SQL (lateral counts).
- Column aliasing to camelCase happens inside the RPC (`json_build_object`) so the wire shape matches zod schemas exactly.

## 3. Seat Map & Locking ⚠️ (most critical part of the system)

```
supabase.rpc("get_seat_map", { trip_id })
```
```json
{
  "layout": { "rows": 12, "cols": 4, "aisleAfterCol": 2 },
  "seats": [
    { "number": "1", "row": 0, "col": 0, "status": "available" },
    { "number": "2", "row": 0, "col": 1, "status": "locked",  "gender": "female" },
    { "number": "3", "row": 0, "col": 3, "status": "booked",  "gender": "male" }
  ]
}
```
- **Gender is present on `locked` and `booked` seats, absent on `available`.** Gender is declared at seat-selection time (see lock request) so it renders immediately, even before checkout completes.

```
supabase.rpc("lock_seats", { trip_id, seats: [{ "seatNumber": "12", "gender": "female" }] })
  → ok: { "lockId": "uuid", "expiresAt": "...(now+10min)" }
  → error: SEAT_ALREADY_LOCKED / SEAT_ALREADY_BOOKED (details.seats = exactly the conflicting seats)
supabase.rpc("release_lock", { lock_id })   → ok (idempotent; releasing a gone lock is still ok)
```

Hard requirements (unchanged in spirit, new mechanism):
- **Atomic all-or-nothing — enforced by Postgres itself:**
  1. `pg_advisory_xact_lock(hashtext(trip_id::text))` serializes lockers per trip.
  2. Delete expired locks for the trip (self-cleaning, no cron needed).
  3. Compute conflicts = requested ∩ (booked ∪ locked). Any conflict → return 409 envelope, lock nothing.
  4. Insert `seat_locks` + `seat_lock_seats`. `UNIQUE(trip_id, seat_number)` on `seat_lock_seats` is the belt-and-suspenders guarantee: a race that slips past step 3 fails the constraint → transaction rolls back → mapped to `SEAT_ALREADY_LOCKED`.
- Lock TTL: 10 minutes (`expires_at`), enforced on read + consumed check — no background job required.
- A lock belongs to `auth.uid()` (anonymous or authenticated); only its owner can consume or release it (`FORBIDDEN` otherwise).
- **Concurrency test is a merge gate:** N parallel `lock_seats` on the same seat → exactly 1 success.

## 4. Booking

```
supabase.rpc("create_booking", {
  lock_id, idempotency_key,        // idempotency_key REQUIRED (uuid from client, reused on retry)
  payment_method: "cash",
  passengers: [{ "seatNumber": "12", "fullName": "...", "phone": "+963...", "gender": "female" }]
})
→ ok: { "id", "pnr": "AZ4X9K", "status": "confirmed",
        "qrPayload": "signed-string", "trip": {...}, "passengers": [...], "totalPrice": 170000 }
→ error: LOCK_EXPIRED (410-equivalent)
```

- **Idempotency:** `UNIQUE(idempotency_key)` on `bookings` + stored response replay: same key within 24h → return the original booking, never a duplicate. Same key + different payload hash → `IDEMPOTENCY_CONFLICT`.
- One transaction: validate lock (exists, owned by caller, unexpired — else `LOCK_EXPIRED`), insert booking + passengers, snapshot `commission_rate` from company, delete the lock. Partial unique index `booking_passengers(trip_id, seat_number) WHERE active` makes double-booking impossible at the DB level.
- Passenger `gender` must equal the gender declared on that seat's lock (`VALIDATION_ERROR` otherwise) — the map never lies.
- `pnr`: 6 chars, alphabet excludes `0 O 1 I`; unique index + retry on collision.
- `qrPayload`: `{bookingId}.{HMAC-SHA256(bookingId + tripId, secret)}` via pgcrypto; secret in Supabase Vault.

- **Booking limits:** before insert, count active future bookings for this `auth.uid()` and for each passenger phone on this trip; over limit → `BOOKING_LIMIT_REACHED` (nothing created).

```
supabase.from("bookings")…                       // GET mine: RLS owner-only (anonymous uid), paginated, newest first
supabase.rpc("get_booking", { id })
supabase.rpc("lookup_booking", { pnr, phone })   // any device, no auth; pair must match → full ticket + QR,
                                                 // else NOT_FOUND (never reveal which field was wrong); rate-limited
supabase.rpc("cancel_booking", { id })           // until 2h before departure, else CANCEL_WINDOW_CLOSED; frees seats (active=false)
```

## 5. Operator (role: operator, scoped by RLS)

- **Tenant isolation is RLS, not query discipline:** every operator-visible table has a policy `company_id = (auth.jwt()->>'company_id')::uuid`. Operator A literally cannot read operator B's rows. Integration test required anyway (OPR-1 AC-3).

```
supabase.from("trips")…                                  // list/filter own trips (RLS-scoped)
supabase.rpc("create_trip" | "update_trip")              // publish → searchable immediately
supabase.rpc("cancel_trip", { trip_id })                 // → all bookings cancelled, returns count
supabase.rpc("get_manifest", { trip_id })                // seat, name, phone, gender, payment status, checkedInAt
supabase.rpc("check_in", { qr_payload })                 // HMAC verify in-DB (Vault secret); wrong company/trip → NOT_FOUND/409 + reason
supabase.rpc("check_in_by_pnr", { pnr })                 // manual fallback
supabase.rpc("operator_cancel_booking", { booking_id })  // no-show mitigation; own-company only (RLS), frees seats
supabase.from("buses")… + rpc("create_bus")              // layout immutable once bus has published trips (409)
supabase.rpc("operator_summary", { from, to })           // bookings, revenue, commission (snapshotted), net, occupancy
```

- Editing price/time on a published trip never touches existing bookings (they store their own `total_price` — test it).

## 6. Admin (role: admin)

```
supabase.from("companies")… + rpc("set_company_status")   // pending|approved|suspended; commissionRate 0.20–0.35 (CHECK constraint)
supabase.from("cities" | "routes")…                       // delete with future trips → blocked (FK/RPC check + explanation)
supabase.from("bookings")…                                // admin RLS: read-all, filters company/date
supabase.rpc("commissions_by_month", { month })           // grouped SQL, per-company totals
```

- `commission_rate` snapshotted onto each booking at creation (rate changes never affect historical bookings).

## 7. Non-Functional

- **Migrations = the contract.** All schema/RPC changes via `supabase/migrations/*.sql` in the repo, PR-reviewed. `supabase gen types typescript` output is committed → frontend zod schemas verified against it.
- Seat map polled every 15s per viewer — `get_seat_map` must be index-backed, p95 < 50ms. **Realtime upgrade (optional, Phase E+):** subscribe to `seat_lock_seats` / `booking_passengers` changes per trip and drop polling.
- Concurrency test suite (parallel lock + parallel identical booking) runs in CI against local `supabase start`.
- Seed script: 6 cities, 3 companies, 2 buses each (12×4, aisleAfterCol 2), 2 weeks of trips incl. one departed + one fully-booked trip. Idempotent. Booked seats seeded with mixed genders (frontend needs to demo the gender map). **Plus: 1 operator account per company + 1 admin account (email+password), documented in README.**

## 8. Schema Sketch

```
profiles(id → auth.users, role, company_id?)          -- operator/admin only; passengers stay anonymous auth.users rows
cities(id, name_ar, name_en, slug unique)
companies(id, name, logo_url, status, commission_rate CHECK 0.20–0.35, rating)
routes(id, from_city_id, to_city_id, default_duration_min)
buses(id, company_id, plate_number, bus_type, layout jsonb)
trips(id, company_id, route_id, bus_id, departure_at, arrival_at, price int, status)
seat_locks(id, trip_id, owner_id, expires_at)
seat_lock_seats(lock_id, trip_id, seat_number, gender)        UNIQUE(trip_id, seat_number)
bookings(id, trip_id, user_id, pnr unique, status, payment_method,
         total_price int, commission_rate, idempotency_key unique, response_snapshot jsonb)
booking_passengers(id, booking_id, trip_id, seat_number, full_name, phone,
                   gender, active bool, checked_in_at?)
                   UNIQUE(trip_id, seat_number) WHERE active
```

Indexes minimum: `trips(route_id, departure_at, status)`, `bookings(trip_id)`, `bookings(user_id)`, `booking_passengers(booking_id)`, `booking_passengers(phone)` (booking-limit check), `bookings(pnr)` unique.
Seat state derivation: `booked` = active booking_passenger row; `locked` = unexpired seat_lock_seats row. No Seat table — seats derive from bus layout.
