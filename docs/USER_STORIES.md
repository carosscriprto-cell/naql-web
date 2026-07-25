# User Stories — v1

Format: story + acceptance criteria (AC). AC are testable — QA and backend build against them, frontend demos against them. Story IDs are stable; reference them in commits/PRs (`feat: PAS-4 seat map`).

Roles: **Passenger** (guest/registered) · **Operator** (bus company staff) · **Admin** (platform).
There is no separate "tenant story" type — operator multi-tenancy (each company sees only its own data) is expressed as AC inside operator stories (see OPR-1 AC-3). Tenant isolation is enforced by Supabase RLS, verified by test.

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
As a passenger, I want to pick my seats from a live seat map — and see the gender of occupied seats so I can choose comfortably.
- AC-1: Map renders from `get_seat_map` (rows/cols/aisle), statuses: available / locked / booked / selected.
- AC-2: **Locked and booked seats display a gender indicator (ذكر/أنثى) — icon + color, with a legend entry.** Available seats show none.
- AC-3: Selecting N seats where N = passengers param; can't exceed.
- AC-4: **Each selected seat has a gender toggle (ذكر default) in the selection bar; gender is sent with the lock request** so other viewers see it immediately.
- AC-5: Map auto-refreshes every 15s; my selection (incl. genders) survives refresh.
- AC-6: Continue → lock request. On conflict, conflicting seats highlighted + toast, selection of those seats cleared, flow stays alive.

### PAS-5: Lock countdown
- AC-1: After lock, visible 10:00 countdown across checkout.
- AC-2: At 0 → dialog "انتهت مهلة الحجز" → back to seat map, lock released.
- AC-3: Leaving flow (back/close) releases lock (best-effort release_lock).

### PAS-6: Checkout (cash)
- AC-1: One passenger form per seat (name required, phone valid +963 format, **gender radio pre-filled from seat selection**).
- AC-2: **Changing gender in the form updates the pending lock's declared gender is NOT allowed in v1 — gender is fixed per seat once locked; to change it, go back to the seat map.** (Keeps the map truthful; booking validates gender matches the lock.)
- AC-3: Payment method fixed to "الدفع في المكتب" in v1, shown clearly.
- AC-4: **No login step — booking completes as guest** (bound to the anonymous session). Phone per passenger is the contact identity.
- AC-5: Confirm sends idempotency key; double-tap creates exactly one booking.
- AC-6: LOCK_EXPIRED response handled per PAS-5 AC-2.
- AC-7: **Anti-abuse (server-side):** max active (non-cancelled, future) bookings per anonymous session and per phone per trip; exceeded → `BOOKING_LIMIT_REACHED` with clear Arabic message.

### PAS-7: Ticket confirmation
- AC-1: Shows PNR, QR, trip summary, passengers/seats **incl. gender**, total, "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" notice.
- AC-2: Ticket accessible later from رحلاتي.

### PAS-8: Cancel booking
- AC-1: Allowed until 2h before departure; button hidden after.
- AC-2: Confirmation dialog; seats return to available.

---

## Epic 3 — Tickets access (Phase C, shrunk — no passenger auth in v1)

> Passenger OTP login/register is **parked to v1.1**. Anonymous Supabase session is the passenger identity in v1; identity linking is the designed upgrade path (no rework).

### PAS-9: ~~OTP login/register~~ — PARKED (v1.1)

### PAS-10: My tickets (device-local)
- AC-1: رحلاتي lists bookings of the current anonymous session (RLS `user_id = auth.uid()`). Tabs: القادمة / السابقة. Newest first, paginated.
- AC-2: Each card → ticket detail with QR.
- AC-3: Empty state explains tickets are per-device and links to استرجاع التذكرة (PAS-11).

### PAS-11: Ticket lookup (any device)
As a passenger, I want to retrieve my ticket with PNR + phone so a new device or cleared browser doesn't lose it.
- AC-1: `/tickets/lookup`: PNR (6 chars) + phone (+963 format) → RPC verifies the pair → full ticket with QR. No auth required.
- AC-2: Wrong pair → generic `NOT_FOUND` ("تأكد من رقم الحجز ورقم الهاتف") — never reveals which field was wrong.
- AC-3: Rate-limited server-side against enumeration.

---

## Epic 4 — Operator (Phase D)

### OPR-0: Operator login
- AC-1: Email + password (Supabase Auth). Accounts created by admin; no self-signup.
- AC-2: Session carries `role=operator` + `companyId` claims; non-operator hitting `/operator/*` → redirect to login.

### OPR-1: Trips list (today-first)
- AC-1: Default view = today's trips with occupancy % per trip.
- AC-2: Filter by date/status (draft/published/cancelled).
- AC-3: **Operator sees only trips belonging to their companyId — enforced by RLS server-side, not just UI; verified by integration test.** (tenant isolation)

### OPR-2: Create/edit trip
- AC-1: Route + bus + departure/arrival + price. Publish makes it searchable ≤1 min.
- AC-2: Editing price/time on published trip does not affect existing bookings' paid price.
- AC-3: Cancel trip → warning with bookings count → all bookings marked cancelled.

### OPR-3: Manifest & check-in
- AC-1: Passenger list per trip: seat, name, **gender**, phone, payment status, checked-in flag.
- AC-2: QR scan (camera) → valid: green + name + seat, mark checked-in. Invalid/other-trip: red with reason.
- AC-3: Manual check-in fallback by PNR search.
- AC-4: **Operator can cancel a booking from the manifest** (confirmation dialog with passenger name/seats) — frees seats; the no-show mitigation for guest bookings.

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
**Passenger OTP accounts (PAS-9 → v1.1, via anonymous identity linking)**, ratings, online payment, GPS tracking, notifications, operator sub-users/permissions, refunds workflow, **gender-based seating rules/enforcement (e.g. preventing mixed adjacency — v1 only displays gender, no constraints)**.
