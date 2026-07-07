# PRD — Intercity Bus Booking Platform (v1)

**Codename:** naql-platform
**Status:** v1 scope locked
**Owner (frontend):** you · **Backend:** separate team · **Last updated:** 2026-07-07

---

## 1. Problem

Intercity bus booking in Syria is manual: passengers go to garages or call offices. No unified system → double-booked seats, empty buses despite demand, zero transparency on schedules/prices.

## 2. Product

A digital marketplace connecting bus companies with passengers. Platform revenue = commission per ticket (20–35%). Asset-light: we own no buses.

## 3. Users

| Role                       | Needs                                                      |
| -------------------------- | ---------------------------------------------------------- |
| **Passenger**              | Search trips, compare, pick seat, book, get e-ticket       |
| **Operator** (bus company) | Publish trips, see bookings/manifest, check-in passengers  |
| **Admin** (platform)       | Approve companies, manage cities/routes, track commissions |

## 4. v1 Scope

### In

1. Trip search: from / to / date / passengers
2. Search results with filters (time, price, company)
3. Trip details + interactive seat map
4. **Seat lock (10 min TTL)** during booking
5. Booking with `paymentMethod: cash` (pay at station) — no payment gateway
6. E-ticket with QR + PNR
7. Auth via phone OTP
8. Operator dashboard: trips CRUD, bookings list, manifest, QR check-in
9. Admin: companies approval, cities, routes

### Out (v2+)

GPS tracking · online payment · ratings/reviews · in-app ads · company subscriptions · push notifications · native apps · loyalty

### Delivery order (frontend)

**Phase A (now):** Homepage only, on mock data — this is what unblocks the backend team.
**Phase B:** Search → Trip → Seats → Checkout → Ticket (mocks via MSW).
**Phase C:** Auth + My Tickets.
**Phase D:** Operator dashboard.
**Phase E:** Swap MSW → real API.

## 5. Core Flows

### 5.1 Passenger booking

```
Home → search(from,to,date) → results → trip details
→ select seats (lock created, 10min countdown)
→ checkout (passenger info + phone OTP if not logged in)
→ POST /bookings {lockId, cash} → ticket (QR + PNR)
```

Edge cases the UI must handle:

- Seat becomes locked/booked by someone else mid-flow → `SEAT_ALREADY_LOCKED` → re-render seat map, keep flow alive
- Lock expiry → banner + redirect back to seat map
- Double-submit on booking → idempotency key

### 5.2 Operator daily

```
Login → today's trips → open trip → manifest → scan QR → check-in
```

## 6. Screens (v1)

**Public/Passenger**
`/` home · `/search` results · `/trips/[id]` details+seats · `/booking/checkout` · `/booking/confirmation` · `/tickets` · `/tickets/[id]` · `/auth/*` · `/routes/[from]-[to]` (SEO static)

**Operator:** `/operator` overview · `/operator/trips` · `/operator/trips/[id]` manifest · `/operator/bookings` · `/operator/buses`

**Admin:** `/admin/companies` · `/admin/cities` · `/admin/routes` · `/admin/bookings`

## 7. Non-Functional

- Mobile-first (≥80% traffic expected mobile), PWA-ready
- Arabic RTL default; i18n structure from day 1 (`next-intl`)
- Seat map refetch interval 15s; stale time 5s
- SEO: route pages (`/routes/damascus-aleppo`) server-rendered
- All prices integer SYP; all datetimes ISO 8601 UTC
- Booking success rate KPI ≥98% → error UX is first-class, not an afterthought

## 8. Success Criteria (v1 launch)

- End-to-end booking (cash) works with zero seat conflicts under concurrent load
- Operator can publish a trip and see it bookable within 1 min
- Homepage LCP < 2.5s on 3G-fast
