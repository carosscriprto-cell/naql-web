# Backend Requirements — v1

Audience: backend team. This is the API contract the frontend is built against (currently mocked with MSW using these exact shapes). Any change to shapes below must be agreed before implementation.

---

## 0. Global Conventions

- **Base URL:** `/api/v1`
- **Datetimes:** ISO 8601 UTC (`2026-07-10T08:30:00Z`). Frontend handles timezone display.
- **Money:** integers, SYP. Never floats. `{ "price": 85000, "currency": "SYP" }`
- **IDs:** UUID strings.
- **Pagination (all list endpoints):**

```json
{ "data": [], "meta": { "page": 1, "perPage": 20, "total": 143 } }
```

- **Error format (every non-2xx):**

```json
{
  "code": "SEAT_ALREADY_LOCKED",
  "message": "Seat 12 was just taken",
  "details": { "seats": ["12"] }
}
```

`code` is a stable machine-readable enum — frontend builds UX on it. Known codes for v1:
`VALIDATION_ERROR · UNAUTHORIZED · FORBIDDEN · NOT_FOUND · SEAT_ALREADY_LOCKED · SEAT_ALREADY_BOOKED · LOCK_EXPIRED · TRIP_DEPARTED · OTP_INVALID · OTP_RATE_LIMITED · IDEMPOTENCY_CONFLICT`

---

## 1. Auth (phone OTP)

Email is irrelevant in this market — phone is the identity.

```
POST /auth/otp/request      { "phone": "+9639XXXXXXXX" }        → 204
POST /auth/otp/verify       { "phone": "...", "code": "123456" } → { accessToken, refreshToken, user }
POST /auth/refresh          { "refreshToken" }                    → { accessToken, refreshToken }
```

Requirements:

- OTP: 6 digits, 5-min expiry, **rate limit 3 requests / 10 min / phone** → `OTP_RATE_LIMITED`
- JWT access token 15 min, refresh 30 days
- Token payload must include: `sub`, `role: "passenger" | "operator" | "admin"`, `companyId?` (operators)
- New phone on successful verify = auto-create passenger account

## 2. Catalog

```
GET /cities                          → [{ id, nameAr, nameEn, slug }]
GET /companies/:slug                 → { id, name, logoUrl, rating, tripsCount }
GET /trips/search?from=&to=&date=&passengers=1
GET /trips/:id
```

`trips/search` item shape (frontend renders exactly this):

```json
{
  "id": "uuid",
  "company": {
    "id": "uuid",
    "name": "الأمانة",
    "logoUrl": "...",
    "rating": 4.6
  },
  "fromCity": { "id": "...", "nameAr": "دمشق" },
  "toCity": { "id": "...", "nameAr": "حلب" },
  "departureAt": "2026-07-10T08:30:00Z",
  "arrivalAt": "2026-07-10T13:00:00Z",
  "price": 85000,
  "currency": "SYP",
  "availableSeats": 32,
  "busType": "VIP"
}
```

- `date` param is the departure date in **local Syria time** (backend converts).
- Only trips with `departureAt > now` and status `published`.

## 3. Seat Map & Locking ⚠️ (most critical part of the system)

```
GET /trips/:id/seats
```

```json
{
  "layout": { "rows": 12, "cols": 4, "aisleAfterCol": 2 },
  "seats": [
    { "number": "1", "row": 0, "col": 0, "status": "available" },
    { "number": "2", "row": 0, "col": 1, "status": "locked" },
    { "number": "3", "row": 0, "col": 3, "status": "booked" }
  ]
}
```

```
POST   /trips/:id/seats/lock   { "seatNumbers": ["12","13"] }
       → 201 { "lockId": "uuid", "expiresAt": "...(now+10min)" }
       → 409 SEAT_ALREADY_LOCKED / SEAT_ALREADY_BOOKED (with details.seats)
DELETE /locks/:lockId          → 204
```

Hard requirements:

- **Lock acquisition must be atomic.** Two concurrent requests for the same seat: exactly one succeeds. Redis `SET NX` with TTL, or DB row-level locking — your choice, but write a concurrency test for it. This is the #1 failure mode of the whole product.
- Lock TTL: 10 minutes, auto-release.
- All-or-nothing: if any requested seat is unavailable, lock none, return 409 listing the conflicting seats.
- A lock belongs to a session/user; only its owner can consume or delete it.

## 4. Booking

```
POST /bookings
Headers: Idempotency-Key: <uuid>   ← REQUIRED
{
  "lockId": "uuid",
  "paymentMethod": "cash",
  "passengers": [{ "seatNumber": "12", "fullName": "...", "phone": "+963..." }]
}
→ 201 { "id", "pnr": "AZ4X9K", "status": "confirmed",
        "qrPayload": "signed-string", "trip": {...}, "passengers": [...], "totalPrice": 170000 }
→ 410 LOCK_EXPIRED
```

- **Idempotency-Key:** same key + same body within 24h → return the original response, don't create a duplicate. Weak networks = double taps.
- Consuming a lock converts seats to `booked` transactionally.
- `pnr`: 6-char human-readable code (no ambiguous chars: no 0/O, 1/I).
- `qrPayload`: signed (HMAC) so operator check-in can verify offline-ish.
- v1 payment is `cash` only — no gateway integration, but keep `paymentMethod` extensible.

```
GET  /bookings/mine                → paginated, newest first
GET  /bookings/:id
POST /bookings/:id/cancel          → allowed until 2h before departure; releases seats
```

## 5. Operator API (role: operator, scoped to their companyId)

```
GET    /operator/trips?date=&status=
POST   /operator/trips             { routeId, busId, departureAt, arrivalAt, price }
PATCH  /operator/trips/:id         (price, times, status: draft|published|cancelled)
GET    /operator/trips/:id/manifest → passengers + seat + checkedIn flag
POST   /operator/check-in          { "qrPayload": "..." } → { booking, passenger } | 404/409
GET    /operator/buses
POST   /operator/buses             { plateNumber, busType, layout: {rows, cols, aisleAfterCol} }
GET    /operator/reports/summary?from=&to=  → { bookings, revenue, commission, occupancyRate }
```

- Cancelling a published trip with bookings → all bookings become `cancelled`, (notification is v2, but persist the state change).

## 6. Admin API (role: admin)

```
GET/POST/PATCH /admin/companies    { name, status: pending|approved|suspended, commissionRate: 0.25 }
GET/POST       /admin/cities
GET/POST       /admin/routes       { fromCityId, toCityId, defaultDurationMin }
GET            /admin/bookings     (filters: company, date range)
GET            /admin/finance/commissions?month=  → per-company totals
```

- `commissionRate` is per-company (0.20–0.35), snapshotted onto each booking at creation time (rate changes must not affect historical bookings).

## 7. Non-Functional

- **OpenAPI/Swagger spec from day 1** — frontend validates responses with zod against it.
- CORS for frontend origin; `Authorization: Bearer`.
- Seat map endpoint will be polled every 15s per active viewer — keep it cheap (cacheable 5s).
- Concurrency test suite for locking + booking (parallel requests, same seat).
- Seed script: 6 cities, 3 companies, 2 buses each, 2 weeks of trips — frontend needs this for integration.

## 8. Entity Sketch

```
City(id, nameAr, nameEn, slug)
Company(id, name, logoUrl, status, commissionRate)
Route(id, fromCityId, toCityId, defaultDurationMin)
Bus(id, companyId, plateNumber, busType, layoutJson)
Trip(id, companyId, routeId, busId, departureAt, arrivalAt, price, status)
SeatLock(id, tripId, seatNumbers[], ownerId, expiresAt)        ← or Redis
Booking(id, tripId, pnr, status, paymentMethod, totalPrice, commissionRate, idempotencyKey)
BookingPassenger(id, bookingId, seatNumber, fullName, phone, checkedInAt?)
User(id, phone, role, companyId?)
```
