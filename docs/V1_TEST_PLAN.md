# V1 Test Plan — naql-platform

**Owner:** backend/QA team · **Source of truth:** `USER_STORIES.md` (every AC below maps 1:1) + `BACKEND_V1.md` (shapes/codes).
**Convention:** Test IDs = `T-<story>-<n>`. Priority: **P0** = launch blocker · P1 = must fix before GA · P2 = fix fast after.
**Environments:** `local` (supabase start + MSW off) · `staging` (integration + all manual suites) · `prod` (smoke only).
**Automated suites** live in `naql-db/tests/` (vitest, CI merge gates) — marked `[AUTO]`. Everything else is manual/exploratory on staging — marked `[MAN]`. `[QA-SCRIPT]` = requires a script from `tools/qa/`.

**Standard test data (from seed):** cities damascus/aleppo/homs/latakia/deir-ez-zor/tartus · 3 approved companies · 12×4 buses (aisleAfterCol 2) · 1 departed trip · 1 fully-booked trip (mixed genders) · operator account per company + 1 admin.

---

## 1. Search & Discovery

### PAS-1 Search trips
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS1-1 | P1 | MAN | Select same city in from + to | Impossible — "to" list excludes selected "from" (and after swap) |
| T-PAS1-2 | P1 | MAN | Open date picker | Past dates disabled; today selectable |
| T-PAS1-3 | P0 | MAN | Search دمشق→حلب tomorrow | Cards show company (logo/name/rating), dep/arr times, duration, price with thousands separator + ل.س, busType badge, availableSeats |
| T-PAS1-4 | P1 | MAN | Search a route/date with no trips | Empty state "لا توجد رحلات في هذا التاريخ" + next-day suggestion button that re-searches |
| T-PAS1-5 | P1 | MAN | Copy `/search?from=&to=&date=&passengers=` URL → open in incognito | Identical results; form pre-filled from params |
| T-PAS1-6 | P0 | AUTO | `search_trips` filters | Only `published`, `departureAt > now`, approved companies returned |
| T-PAS1-7 | P1 | AUTO | Date boundary: trip at 23:30 Damascus time | Appears on the correct **local** date (Asia/Damascus window conversion) |
| T-PAS1-8 | P1 | AUTO | availableSeats math | = capacity − active booked − unexpired locks; trip drops out when < passengers param |

### PAS-2 Filters & sort
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS2-1 | P1 | MAN | Apply صباح window chip | Only 05:00–12:00 departures (local time) shown; count line updates |
| T-PAS2-2 | P1 | MAN | Company multi-select + busType VIP combined | AND logic; count "N رحلة متاحة" correct |
| T-PAS2-3 | P1 | MAN | Sort الأقل سعراً | Ascending by price; default sort is earliest departure |
| T-PAS2-4 | P1 | MAN | Apply filters → reload page | URL contains filter params; state fully restored (AC-3) |
| T-PAS2-5 | P2 | MAN | Clear all filters | Full result set returns; URL params removed |
| T-PAS2-6 | P1 | MAN | Mobile 375px | Filters in Sheet via "تصفية" button with active-count badge |

### PAS-3 Trip details
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS3-1 | P1 | MAN | Open trip details | Route, times, duration, company card + rating, price/seat, callout "الإلغاء مجاني حتى ساعتين قبل الانطلاق" |
| T-PAS3-2 | P0 | MAN | Open the seeded **departed** trip | CTA disabled with "انطلقت الرحلة"; seat map not interactive |
| T-PAS3-3 | P0 | MAN | Open the seeded **full** trip | CTA disabled with "اكتملت المقاعد" |
| T-PAS3-4 | P1 | AUTO | `get_trip` on draft / suspended-company trip | Envelope NOT_FOUND |

---

## 2. Seat Map, Gender & Locking ⚠️ (core)

### PAS-4 Seat map + selection + gender
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS4-1 | P0 | MAN | Render seeded map | 12×4 grid, visible aisle gap after col 2, RTL-correct orientation, السائق indicator, legend row |
| T-PAS4-2 | P0 | MAN | Inspect locked + booked seats | Each shows gender icon (ذكر/أنثى distinct icon+color); available seats show none; legend includes both genders |
| T-PAS4-3 | P0 | MAN | `?passengers=2` → try selecting 3rd seat | Blocked at 2; deselect works; selected = teal filled |
| T-PAS4-4 | P0 | MAN | Selection bar gender toggle | Each selected seat chip has ذكر/أنثى toggle, default ذكر; total price = price × N |
| T-PAS4-5 | P1 | MAN | Wait through a 15s refetch with selection active | Selection + chosen genders survive (AC-5) |
| T-PAS4-6 | P0 | MAN×2 devices | Device B books a seat device A has selected → wait refetch on A | Seat dropped from A's selection + sonner toast; flow alive |
| T-PAS4-7 | P1 | MAN | 375px audit | Seat tap targets ≥40px; gender icons legible |
| T-PAS4-8 | P0 | AUTO | `get_seat_map` statuses | available/locked/booked derived correctly; gender only on locked+booked |

### Locking (PAS-4 AC-6 + BACKEND_V1 §3)
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-LOCK-1 | **P0** | AUTO | 10 parallel `lock_seats`, same seat, 10 sessions | **Exactly 1 ok, 9 × SEAT_ALREADY_LOCKED** — the #1 failure mode of the product |
| T-LOCK-2 | **P0** | AUTO | Parallel overlapping sets ["5","6"] vs ["6","7"] | One succeeds; other gets conflict with details.seats=["6"] exactly; **zero partial lock rows ever** |
| T-LOCK-3 | P0 | AUTO | Lock seat already booked | SEAT_ALREADY_BOOKED with exact seats; nothing locked (all-or-nothing) |
| T-LOCK-4 | P0 | AUTO | Expire a lock (force expires_at past) | Seat available in map + lockable again, no cleanup job needed |
| T-LOCK-5 | P0 | AUTO | `release_lock` by non-owner / by owner / on gone lock | FORBIDDEN / ok + seat freed / ok (idempotent) |
| T-LOCK-6 | P0 | AUTO | Gender propagation | Gender in lock request visible via `get_seat_map` from a different session |
| T-LOCK-7 | P0 | MAN [QA-SCRIPT] | Staging: seat 13 pre-locked → select it + متابعة | 409 UX: seat highlighted (destructive ring), toast "تم حجز بعض المقاعد للتو...", removed from selection, map refetched, page stays |
| T-LOCK-8 | **P0** | MAN×2 | Two humans, two devices, same seat, tap متابعة same moment | One proceeds to checkout; other gets full 409 recovery UX |
| T-LOCK-9 | P1 | MAN | Lock seats → navigate back / close tab → return to trip | Best-effort release fired; seats free again (within grace) |
| T-LOCK-10 | P1 | AUTO | Lock without any session | UNAUTHORIZED (frontend must have called signInAnonymously first) |

### PAS-5 Lock countdown
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS5-1 | P0 | MAN | After lock → checkout | Sticky 10:00 countdown; derived from server expiresAt (change device clock — countdown unaffected) |
| T-PAS5-2 | P1 | MAN | Under 2:00 | Countdown turns destructive style |
| T-PAS5-3 | P0 | MAN [QA-SCRIPT] | Shortened lock reaches 0 | Dialog "انتهت مهلة الحجز" single action → back to seat map, store cleared, lock released |

---

## 3. Checkout & Booking

### PAS-6 Checkout (guest, cash)
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS6-1 | P1 | MAN | Open /booking/checkout directly with empty store | Redirect home (guard) |
| T-PAS6-2 | P0 | MAN | Passenger forms | One card per seat titled by seat number; gender shown as **read-only badge** matching seat selection + hint "لتغيير الجنس عد لاختيار المقاعد" |
| T-PAS6-3 | P1 | MAN | fullName < 3 chars / phone `0999...` / phone `+96388...` | Arabic validation messages; submit blocked. Valid: `+9639XXXXXXXX` |
| T-PAS6-4 | P2 | MAN | "نفس الرقم لجميع الركاب" checkbox | First phone propagates; unchecking restores editability |
| T-PAS6-5 | P1 | MAN | Payment section | Single option "الدفع في المكتب" checked+disabled with explainer; no other method visible |
| T-PAS6-6 | P0 | MAN | Full guest flow, fresh incognito profile | **No login/OTP step anywhere** search→ticket (AC-4) |
| T-PAS6-7 | **P0** | AUTO | Two **parallel** identical `create_booking` (same idempotency key) | Exactly one booking row; both callers receive identical response |
| T-PAS6-8 | P0 | MAN | Throttle to Slow-3G (DevTools) → double/triple-tap تأكيد الحجز | Button disabled while pending; exactly one booking (verify staging data) |
| T-PAS6-9 | P0 | AUTO | Same key + different body | IDEMPOTENCY_CONFLICT |
| T-PAS6-10 | P0 | AUTO | Booking with expired/foreign/missing lock | LOCK_EXPIRED (all three) |
| T-PAS6-11 | P0 | MAN | LOCK_EXPIRED during checkout submit | Same dialog/flow as countdown-zero (AC-6) |
| T-PAS6-12 | P0 | AUTO | Passenger gender ≠ lock's declared gender | VALIDATION_ERROR; nothing created |
| T-PAS6-13 | P0 | AUTO | 5th active future booking same anonymous uid; and per-phone-per-trip limit | BOOKING_LIMIT_REACHED; nothing created (AC-7) |
| T-PAS6-14 | P1 | AUTO | Commission snapshot | Booking stores company's current rate; later rate change doesn't alter it |
| T-PAS6-15 | P1 | AUTO | totalPrice | = trip.price × seats, integer SYP |

### PAS-7 Ticket confirmation
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS7-1 | P0 | MAN | Confirmation page | PNR prominent + copy works, QR renders, trip summary, passengers table (seat/name/**gender**/phone), total, notice "ادفع في المكتب قبل الانطلاق بـ 30 دقيقة" |
| T-PAS7-2 | P0 | AUTO | PNR format ×200 generated | 6 chars, never contains 0/O/1/I, unique |
| T-PAS7-3 | P1 | MAN | Browser back from confirmation | Does NOT return to checkout (router.replace) |
| T-PAS7-4 | P1 | MAN | Open /booking/confirmation with empty store | Redirect home |
| T-PAS7-5 | P0 | MAN×2 | After booking, device B opens same trip's map | Seats booked with correct genders within one refresh cycle |

### PAS-8 Cancel booking
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS8-1 | P1 | MAN | Ticket >2h before departure | Cancel visible → confirmation dialog → cancelled; seats available again on map |
| T-PAS8-2 | P0 | AUTO | Cancel at 1h59m before departure (server-side) | CANCEL_WINDOW_CLOSED regardless of UI |
| T-PAS8-3 | P1 | MAN | Ticket <2h before departure | Cancel button hidden |
| T-PAS8-4 | P1 | AUTO | Cancel by non-owner session | FORBIDDEN/NOT_FOUND — never succeeds |

---

## 4. Tickets Access (no passenger auth)

### PAS-10 My tickets (device-local)
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS10-1 | P1 | MAN | Book 2 trips (one future, one past via seed) → رحلاتي | Tabs القادمة/السابقة correct; newest first |
| T-PAS10-2 | P1 | MAN | Fresh incognito → رحلاتي | Empty state explains per-device tickets + link to استرجاع التذكرة |
| T-PAS10-3 | P0 | AUTO | RLS: session A queries bookings | Only own rows; direct PostgREST select of others returns zero rows |

### PAS-11 PNR lookup
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-PAS11-1 | P0 | MAN | Different device: correct PNR + phone | Full ticket + QR, no auth |
| T-PAS11-2 | P0 | AUTO | Correct PNR + wrong phone / wrong PNR + correct phone | **Byte-identical** NOT_FOUND both cases (no field disclosure) |
| T-PAS11-3 | P1 | AUTO | 11th lookup attempt same PNR within 1h | NOT_FOUND (enumeration rate limit) |
| T-PAS11-4 | P2 | MAN | Lowercase pnr input | Uppercased/accepted client-side |

---

## 5. Operator

### OPR-0 Login
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-OPR0-1 | P0 | MAN | Seeded operator email+password | Login ok; JWT carries role=operator + companyId (verify via a scoped call) |
| T-OPR0-2 | P0 | MAN | Passenger/anonymous hits /operator/* | Redirect to login; no data flash |
| T-OPR0-3 | P1 | MAN | Public signup attempt | Impossible — signups disabled |

### OPR-1 Trips list — incl. tenant isolation
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-OPR1-1 | P1 | MAN | Default view | Today's trips + occupancy % each; date/status filters work |
| T-OPR1-2 | **P0** | AUTO | Operator A calls get_manifest / update_trip / operator_cancel_booking / trips select on **operator B's** data — via API directly, not UI | NOT_FOUND/FORBIDDEN/zero rows on every path. **Launch blocker (OPR-1 AC-3)** |

### OPR-2 Trips CRUD
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-OPR2-1 | P0 | MAN | Create draft → publish → passenger searches | Bookable within ≤1 min |
| T-OPR2-2 | P0 | AUTO | Change price on published trip with bookings | Existing bookings' totalPrice + commission math untouched |
| T-OPR2-3 | P0 | MAN | Cancel published trip with bookings | Warning shows bookings count → all bookings `cancelled`; trip gone from search; affected passenger sees cancelled state in رحلاتي |

### OPR-3 Manifest & check-in
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-OPR3-1 | P0 | MAN | Open manifest | seat, name, **gender**, phone, payment status, checkedIn flag per passenger |
| T-OPR3-2 | P0 | MAN | Scan valid QR (phone camera on real ticket) | Green + name + seat; checkedInAt set; re-scan → already-checked-in error with timestamp |
| T-OPR3-3 | P0 | AUTO | Tampered qrPayload (flip one hex char) / valid QR of **another company's** booking | Rejected with reason — HMAC + ownership both enforced |
| T-OPR3-4 | P1 | MAN | Manual check-in by PNR | Same result as scan |
| T-OPR3-5 | P1 | MAN | operator_cancel_booking from manifest | Confirmation dialog with name/seats → seats freed on public map (no-show mitigation) |
| T-OPR3-6 | P1 | AUTO | operator_cancel_booking on other company's booking | NOT_FOUND |

### OPR-4 Buses / OPR-5 Reports
| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-OPR4-1 | P1 | MAN | CRUD bus with 12×4 layout → publish a trip on it → edit layout | Blocked with explanation (immutable after first published trip) |
| T-OPR5-1 | P1 | AUTO | Summary over seeded range | bookings/gross/commission/net/occupancy correct vs hand-computed fixture; uses **snapshotted** rates |

---

## 6. Admin

| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-ADM1-1 | **P0** | MAN | Suspend a company → passenger searches immediately | Its trips vanish from results instantly (query-time filter, no cache) |
| T-ADM1-2 | P0 | AUTO | Set commissionRate 0.19 / 0.36 / 0.30 | First two → VALIDATION_ERROR; 0.30 ok. Historical bookings keep old rate (regression with commissions_by_month) |
| T-ADM2-1 | P1 | AUTO | Delete city/route having future published trips | Blocked with explanation; deletable when none |
| T-ADM3-1 | P1 | MAN | Bookings overview filters (company/date) + monthly commission totals | Correct vs fixture |
| T-ADM-SEC | P0 | AUTO | Operator/anonymous calls any admin RPC | FORBIDDEN — all of them |

---

## 7. Security & Access Suite (cross-cutting) — all P0

| ID | Type | Case | Expected |
|---|---|---|---|
| T-SEC-1 | AUTO | Grants audit: enumerate callable functions as `anon` | Only: search_trips, get_trip, get_seat_map, lock_seats, release_lock, create_booking, cancel_booking, lookup_booking, get_booking |
| T-SEC-2 | AUTO | Direct PostgREST writes with anon key: INSERT/UPDATE on trips, bookings, seat_locks, companies | All rejected (RLS deny-by-default; writes only via RPCs) |
| T-SEC-3 | AUTO | Direct PostgREST reads with anon key: draft trips, profiles, others' bookings, pending companies | Zero rows |
| T-SEC-4 | MAN | Inspect network tab | Only anon key in client; service role never shipped; no secrets in bundle |
| T-SEC-5 | AUTO | Error envelope shape on every failure path exercised above | Always `{ ok:false, error:{ code, message, details? } }`, code from the fixed enum — frontend UX depends on it |

## 8. Performance Suite

| ID | P | Type | Case | Target |
|---|---|---|---|---|
| T-PERF-1 | P0 | AUTO [k6] | `get_seat_map` 200 concurrent viewers/trip | p95 < 50ms, 0 errors |
| T-PERF-2 | P0 | AUTO [k6] | `lock_seats` burst (mixed conflicting) | Correctness holds under load (still exactly-one semantics); p95 < 200ms |
| T-PERF-3 | P1 | MAN | Homepage on throttled 3G-fast, mid-range Android | LCP < 2.5s |
| T-PERF-4 | P1 | MAN | search + trip pages | No layout shift on data load (skeletons in place) |

## 9. RTL / i18n / Device Matrix

| ID | P | Case | Expected |
|---|---|---|---|
| T-RTL-1 | P1 | Visual sweep every screen (grep also: no `pl-`/`pr-` classes) | Logical properties only; arrows/chevrons/route-direction correct in RTL |
| T-RTL-2 | P1 | All UI strings | From ar.json — no hardcoded/English leaks; Arabic validation messages |
| T-RTL-3 | P1 | Numbers/dates | Prices thousands-separated + ل.س; dates via date-fns ar locale |
| T-DEV-1 | P0 | Full booking happy path on: low-end Android Chrome, iOS Safari, desktop Chrome/Firefox @375px+1440px | No blockers on any |
| T-DEV-2 | P1 | iOS Safari specifics | Anonymous session persists across app switches; sticky countdown not obscured by browser chrome |

## 10. Resilience & Edge

| ID | P | Type | Case | Expected |
|---|---|---|---|---|
| T-RES-1 | P1 | MAN | Kill network mid-checkout → restore → retry | Same idempotency key reused → one booking |
| T-RES-2 | P1 | MAN | Unhandled/unknown error code from any call | Generic toast "حدث خطأ، حاول مجدداً" — never a blank screen |
| T-RES-3 | P1 | MAN | Back-nav matrix: checkout→back→map | Selection+genders kept, lock released, re-lock on متابعة works |
| T-RES-4 | P2 | MAN | Clear site data mid-flow | Guards redirect cleanly; tickets recoverable via PNR lookup |
| T-RES-5 | P1 | AUTO | Trip departs while user holds a lock → create_booking | TRIP_DEPARTED or LOCK_EXPIRED — never a booking on a departed trip |

---

## 11. Launch Gate Checklist (all must be ✅)

- [ ] All **P0** cases pass on staging, including both MAN×2-device tests (T-LOCK-8, T-PAS7-5)
- [ ] Automated suites (concurrency, booking, RLS, security, tenant isolation) green **5 consecutive CI runs** — zero flakes
- [ ] k6 targets met (T-PERF-1/2) on staging-sized data
- [ ] Backup **restore drill executed once** on a scratch project (data verified, time-to-restore documented)
- [ ] QA scripts in `tools/qa/` working on staging: pre-lock seat 13 · shortened lock (LOCK_EXPIRED) · BOOKING_LIMIT demo data
- [ ] Seed credentials rotated for prod; Vault QR secret set in prod; grants audit (T-SEC-1) re-run **against prod**
- [ ] Smoke on prod after deploy: search → lock → book → PNR lookup → operator check-in (1 real ticket, then operator-cancel it)

## 12. Regression Pack (run on every release after v1)

Minimal set: T-LOCK-1, T-LOCK-2, T-PAS6-7, T-PAS6-13, T-OPR1-2, T-ADM1-2, T-SEC-1..3, T-PERF-1 — all automated, ~5 min in CI. Manual add-on per release: one full happy path on a real Android device.
