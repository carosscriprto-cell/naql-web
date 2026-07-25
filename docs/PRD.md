# PRD — Intercity Bus Booking Platform (v1)

**Codename:** naql-platform
**Status:** v1 scope locked · **backend stack revised → Supabase** (2026-07-18)
**Owner (frontend):** you · **Backend:** Supabase project (migrations/RPCs) · **Last updated:** 2026-07-18

---

## 1. Problem

Intercity bus booking in Syria is manual: passengers go to garages or call offices. No unified system → double-booked seats, empty buses despite demand, zero transparency on schedules/prices.

## 2. Product

A digital marketplace connecting bus companies with passengers. Platform revenue = commission per ticket (20–35%). Asset-light: we own no buses.

## 3. Users

| Role | Needs |
|---|---|
| **Passenger** | Search trips, compare, pick seat, book, get e-ticket |
| **Operator** (bus company) | Publish trips, see bookings/manifest, check-in passengers |
| **Admin** (platform) | Approve companies, manage cities/routes, track commissions |

## 4. v1 Scope

### In
1. Trip search: from / to / date / passengers
2. Search results with filters (time, price, company)
3. Trip details + interactive seat map
4. **Seat lock (10 min TTL)** during booking
5. **Passenger gender (ذكر/أنثى) — declared per seat at selection, displayed on locked/booked seats and in manifest.** Display only; no seating-rule enforcement in v1.
6. Booking with `paymentMethod: cash` (pay at station) — no payment gateway
7. E-ticket with QR + PNR
8. **Guest booking — no passenger login/OTP in v1.** Anonymous Supabase sessions bind locks + bookings to the device; phone required per passenger. Ticket retrieval anywhere via **PNR + phone lookup**. Anti-abuse: booking limits per session/phone + operator can cancel from manifest.
9. Operator/admin auth: **email + password** (Supabase Auth, accounts created by admin)
10. Operator dashboard: trips CRUD, bookings list, manifest, QR check-in
11. Admin: companies approval, cities, routes

### Out (v2+)
**Passenger accounts / phone OTP (v1.1 — identity-linking path already built)** · GPS tracking · online payment · ratings/reviews · in-app ads · company subscriptions · push notifications · native apps · loyalty · gender-based seating constraints

### Backend (revised)
Supabase: Postgres + RLS + plpgsql RPCs for all critical writes (locking, booking, check-in), Supabase Auth (anonymous guests → OTP-linked accounts). No custom API server, no Redis. Contract: `BACKEND_V1.md` (Supabase edition) + committed generated types.

### Delivery order (frontend)
**Phase A (done):** Homepage on mock data.
**Phase B (in progress — Task 9 done):** Search → Trip → Seats (with gender) → Checkout → Ticket (mocks via MSW).
**Phase C (shrunk):** My Tickets (device-local) + PNR lookup — lands as Task E4. No passenger auth.
**Phase D:** Operator dashboard (incl. email login).
**Phase E:** Swap MSW → supabase-js, one feature per task (E1–E5).

## 5. Core Flows

### 5.1 Passenger booking
```
Home → search(from,to,date) → results → trip details
→ select seats + gender per seat (lock created with genders, 10min countdown)
→ checkout (passenger info, gender pre-filled read-only — no login step)
→ create_booking(lockId, cash, passengers[gender]) → ticket (QR + PNR)
Retrieval later: رحلاتي (same device) or /tickets/lookup (PNR + phone, any device)
```
Edge cases the UI must handle:
- Seat becomes locked/booked by someone else mid-flow → `SEAT_ALREADY_LOCKED` → re-render seat map, keep flow alive
- Lock expiry → banner + redirect back to seat map
- Double-submit on booking → idempotency key

### 5.2 Operator daily
```
Login → today's trips → open trip → manifest (incl. gender) → scan QR → check-in
```

## 6. Screens (v1)

**Public/Passenger**
`/` home · `/search` results · `/trips/[id]` details+seats · `/booking/checkout` · `/booking/confirmation` · `/tickets` (device-local) · `/tickets/[id]` · `/tickets/lookup` (PNR + phone) · `/routes/[from]-[to]` (SEO static)

**Auth screens:** `/operator/login` + `/admin/login` only (email+password). No passenger auth screens in v1.

**Operator:** `/operator` overview · `/operator/trips` · `/operator/trips/[id]` manifest · `/operator/bookings` · `/operator/buses`

**Admin:** `/admin/companies` · `/admin/cities` · `/admin/routes` · `/admin/bookings`

## 7. Non-Functional

- Mobile-first (≥80% traffic expected mobile), PWA-ready
- Arabic RTL default; i18n structure from day 1 (`next-intl`)
- Seat map refetch interval 15s; stale time 5s (Realtime subscription optional upgrade, Task E5)
- SEO: route pages (`/routes/damascus-aleppo`) server-rendered
- All prices integer SYP; all datetimes ISO 8601 UTC
- Booking success rate KPI ≥98% → error UX is first-class, not an afterthought

## 8. Success Criteria (v1 launch)

- End-to-end booking (cash) works with zero seat conflicts under concurrent load (Postgres concurrency suite green)
- Gender visible on taken seats across concurrent viewers within one refresh cycle
- Operator can publish a trip and see it bookable within 1 min
- Homepage LCP < 2.5s on 3G-fast
