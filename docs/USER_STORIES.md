# User Stories — v1

Format: story + acceptance criteria (AC). AC are testable — QA and backend build against them, frontend demos against them. Story IDs are stable; reference them in commits/PRs (`feat: PAS-4 seat map`).

Roles: **Passenger** (guest/registered) · **Operator** (bus company staff) · **Admin** (platform).
There is no separate "tenant story" type — operator multi-tenancy (each company sees only its own data) is expressed as AC inside operator stories (see OPR-1 AC-3).

---

## Epic 1 — Search & Discovery (Phase A/B)

### PAS-1: Search trips

As a passenger, I want to search trips by from/to/date so I can see available options.

- AC-1: From/to are selectable city lists; same city cannot be both.
- AC-2: Date cannot be in the past.
- AC-3: Results show company, times, duration, price, bus type, available seats.
- AC-4: Empty state with suggestion to change date when no trips.
- AC-5: Search is shareable via URL (`/search?from=&to=&date=`).

### PAS-2: Filter & sort results

- AC-1: Filter by departure window (صباح/ظهر/مساء), company, bus type.
- AC-2: Sort by price / earliest departure. Default: earliest.
- AC-3: Filters reflected in URL params.

### PAS-3: View trip details

- AC-1: Shows route, times, company info + rating, price, cancellation policy (2h rule).
- AC-2: Departed or full trips show disabled booking CTA with reason.

---

## Epic 2 — Booking (Phase B) ⚠️ core

### PAS-4: Select seats

As a passenger, I want to pick my seats from a live seat map.

- AC-1: Map renders from layout API (rows/cols/aisle), statuses: available / locked / booked / selected.
- AC-2: Selecting N seats where N = passengers param; can't exceed.
- AC-3: Map auto-refreshes every 15s; my selection survives refresh.
- AC-4: Continue → lock request. On 409, conflicting seats highlighted + toast, selection of those seats cleared, flow stays alive.

### PAS-5: Lock countdown

- AC-1: After lock, visible 10:00 countdown across checkout.
- AC-2: At 0 → dialog "انتهت مهلة الحجز" → back to seat map, lock released.
- AC-3: Leaving flow (back/close) releases lock (best-effort DELETE).

### PAS-6: Checkout (cash)

- AC-1: One passenger form per seat (name required, phone valid +963 format).
- AC-2: Payment method fixed to "الدفع في المكتب" in v1, shown clearly.
- AC-3: If guest → OTP step inline before confirm (PAS-9).
- AC-4: Confirm sends Idempotency-Key; double-tap creates exactly one booking.
- AC-5: LOCK_EXPIRED response handled per PAS-5 AC-2.

### PAS-7: Ticket confirmation

- AC-1: Shows PNR, QR, trip summary, passengers/seats, total, "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" notice.
- AC-2: Ticket accessible later from رحلاتي.

### PAS-8: Cancel booking

- AC-1: Allowed until 2h before departure; button hidden after.
- AC-2: Confirmation dialog; seats return to available.

---

## Epic 3 — Auth (Phase C)

### PAS-9: OTP login/register

- AC-1: Phone entry → 6-digit OTP → verified session. New phone auto-creates account.
- AC-2: Resend disabled 60s; 3 attempts / 10min → OTP_RATE_LIMITED message.
- AC-3: Session persists (refresh token); logout clears it.

### PAS-10: My tickets

- AC-1: Tabs: القادمة / السابقة. Newest first, paginated.
- AC-2: Each card → ticket detail with QR.

---

## Epic 4 — Operator (Phase D)

### OPR-1: Trips list (today-first)

- AC-1: Default view = today's trips with occupancy % per trip.
- AC-2: Filter by date/status (draft/published/cancelled).
- AC-3: **Operator sees only trips belonging to their companyId — verified server-side, not just UI.** (tenant isolation)

### OPR-2: Create/edit trip

- AC-1: Route + bus + departure/arrival + price. Publish makes it searchable ≤1 min.
- AC-2: Editing price/time on published trip does not affect existing bookings' paid price.
- AC-3: Cancel trip → warning with bookings count → all bookings marked cancelled.

### OPR-3: Manifest & check-in

- AC-1: Passenger list per trip: seat, name, phone, payment status, checked-in flag.
- AC-2: QR scan (camera) → valid: green + name + seat, mark checked-in. Invalid/other-trip: red with reason.
- AC-3: Manual check-in fallback by PNR search.

### OPR-4: Buses

- AC-1: CRUD buses with seat layout (rows/cols/aisle). Layout locked once bus has published trips.

### OPR-5: Reports

- AC-1: Date-range summary: bookings, gross revenue, platform commission, net, occupancy.

---

## Epic 5 — Admin (Phase D)

### ADM-1: Company approval

- AC-1: Pending → approved/suspended. Suspended company's trips vanish from search immediately.
- AC-2: Commission rate set per company (0.20–0.35); historical bookings keep their snapshotted rate.

### ADM-2: Cities & routes

- AC-1: CRUD; deleting a city/route with future trips is blocked with explanation.

### ADM-3: Bookings & commissions overview

- AC-1: Filter bookings by company/date. Monthly commission totals per company.

---

## Out of v1 (parked)

Ratings (PAS-x), online payment, GPS tracking, notifications, operator sub-users/permissions, refunds workflow.
