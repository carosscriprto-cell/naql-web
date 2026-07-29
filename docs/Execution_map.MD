# خريطة التنفيذ — naql-web (بعد E3)

**آخر تحديث:** 2026-07-29 · **الحالة:** الباك 104/104 أخضر على DEV · E3 هبط (لم يُختبَر في متصفح بعد)

---

## 0. قواعد ثابتة لكل جلسة — لا تُكرَّر داخل البرومبتات

انسخ هذه الكتلة **مرة واحدة** في أول جلسة مع أي agent جديد، ثم أشِر إليها بـ "اتبع قواعد EXECUTION_MAP §0".

```
Standing rules for every session in this repo:

1. Conventions live in CLAUDE.md. Contract lives in docs/BACKEND_V1.md. Read them yourself —
   never ask me to paste them, and never paste them back to me.
2. NEVER run `npm run build`. It is slow and I run it myself. Your verify is limited to
   `npx tsc --noEmit` and `npm run lint`, plus at most ONE targeted test file when the task
   touches tested code.
3. NEVER run `npm run db:test` in full (152s). If a task needs a db check, run one file:
   `npx vitest run -c vitest.db.config.ts tests/db/<file>.test.ts`
4. NEVER apply anything to the database. Port 5432 is blocked on this network. Backend tasks
   produce a migration FILE only; I apply it by hand via docs/MANUAL_MIGRATION_RUNBOOK.md.
   Do not run db:reset, migration up, db push, or any SQL against DEV.
5. Touch only the files the task lists. If the task cannot be done inside them, STOP and say why
   instead of widening the scope.
6. Report token-efficiently: what changed, what you verified, what you deliberately did not fix.
   No summaries of code I can read, no restating the prompt back to me.
7. If you find a contract mismatch, report it as a BACKEND_V1 doc issue. Do not silently adapt
   either side.
```

---

## 1. ترتيب العمل

| # | المهمة | الطبقة | الحجم | يحجب | محجوب بـ |
|---|---|---|---|---|---|
| **QA-1** | جولة متصفح على E3 | يدوي | S | كل ما بعده | — |
| **F1** | معالجات أكواد الأخطاء الأربعة | fe | S | — | QA-1 |
| **B8** | قيود `buses` (bus_type + layout) | be | S | — | — |
| **F2** | E4 — التذاكر + استرجاع PNR | fe | M | QA-2 | F1 |
| **QA-2** | QA الانتقال الكامل (ملف منفصل) | يدوي | M | الإطلاق | F2 |
| **B9** | Admin RPCs (§6) | be | M | F4 | — |
| **B10** | عمود `payment_status` | be | S | F3 | — |
| **F3** | Phase D — بوابة المشغّل (مقلَّصة) | fe | L | الإطلاق | B10 |
| **F4** | واجهة الإدارة | fe | M | الإطلاق | B9 |
| **INF** | PROD + Vault + استعادة + k6 | infra | L | الإطلاق | الكل |

**المسار الحرج:** QA-1 → F1 → F2 → QA-2 → F3 → INF

B8 و B9 و B10 مستقلة — نفّذها في أي فجوة.

---

## 2. كيف تتحقق أنت من كل مهمة

قسمة ثابتة: **الوكيل** يتحقق مما هو رخيص وآلي، **أنت** تتحقق مما يحتاج متصفحاً أو وقتاً.

| يفعله الوكيل | تفعله أنت |
|---|---|
| `npx tsc --noEmit` | `npm run build` |
| `npm run lint` | جولة المتصفح |
| ملف تست واحد مستهدف | `npm run db:test` كاملاً (عند الحاجة) |
| قراءة العقد ومطابقة الأشكال | تطبيق الـ migration يدوياً |

**قاعدة عامة:** إن ادّعى الوكيل نجاح شيء لم يستطع تشغيله (متصفح، بناء، قاعدة بيانات)، اعتبره **غير متحقَّق منه** حتى تشغّله بنفسك. ادّعاء "PASS" على مستوى النقل لا يعني أن الواجهة تعمل.

---

## QA-1 — جولة متصفح على E3 (أنت، الآن)

E3 هبط لكن لم يُفتح متصفح واحد. هذه أول مرة تعمل فيها الخريطة على قاعدة حقيقية.

**التجهيز**
```
.env.local → NEXT_PUBLIC_USE_MOCKS=false
npm run build      ← لم يُنفَّذ بعد؛ إزالة معالجات MSW قد تكسر بناء الإنتاج
npm run dev
```

**قبل أي شيء:** DevTools → Application → Service Workers → **Unregister**. الـ worker القديم يبقى مسجّلاً بعد إيقاف MSW، وسيخدمك بيانات وهمية وأنت تظن أنك على DEV.

**لا تفتح نوافذ تصفح خفي متكررة** — حصة DEV ~30 جلسة مجهولة/ساعة/IP. تجاوزها يعطيك `UNAUTHORIZED` يبدو كعطل.

| # | الخطوة | المتوقع |
|---|---|---|
| 1 | افتح رحلة مستقبلية | الخريطة ترسم 48 مقعداً، 12×4، فجوة ممر بعد العمود 2 |
| 2 | Network tab | طلبات إلى `supabase.co/rest/v1/rpc/get_seat_map` — **لا** إلى `/api/*` |
| 3 | اختر مقعدين بجنسين مختلفين | الشارات صحيحة، المجموع صحيح |
| 4 | متابعة | انتقال إلى الدفع + عدّاد يبدأ من 10:00 وينزل ثانية بثانية |
| 5 | زر الرجوع | المقعدان متاحان مجدداً على الخريطة |
| 6 | أعد القفل، املأ البيانات، تأكيد | PNR حقيقي + QR |
| 7 | SQL Editor: `select pnr from bookings order by created_at desc limit 1;` | نفس الرمز |
| 8 | Console | لا أخطاء حمراء |

**فشل صريح:** ظهور بيانات وهمية (worker) · الخريطة لا ترسم · `/api/` في Network.

---

## F1 — معالجات أكواد الأخطاء

```
اتبع قواعد EXECUTION_MAP §0.

Four ApiError.codes reach the UI from lock_seats and fall through to the generic toast, throwing
away information the server already provides.

FILES: src/features/booking/components/seat-selection.tsx · src/messages/ar.json

Alongside the existing SEAT_ALREADY_LOCKED / SEAT_ALREADY_BOOKED cases add:
  TRIP_DEPARTED    → "انطلقت الرحلة" + disable the CTA. REUSE the existing ar.json key from the
                     trip-detail departed state — do not introduce a second wording for the same fact.
  NOT_FOUND        → trip no longer available; route the user back to search.
  VALIDATION_ERROR → seat-selection error, flow stays alive.
  UNAUTHORIZED     → "تعذّر بدء الجلسة، حاول مجدداً". This is signInAnonymously being refused, not a
                     login problem. Must NOT imply the user needs an account — there is no passenger
                     login in v1 (BACKEND_V1 §1).

Keep the generic toast as the fallback for unknown codes (V1_TEST_PLAN T-RES-2).
All strings from src/messages/ar.json — no Arabic literals in tsx.

NOT in this task: new components, other screens, error handling outside lock_seats.
```

**الوكيل:** `tsc` · `lint`
**أنت:** `npm run build` · افتح رحلة منطلقة → اختر مقعداً → متابعة → يجب أن ترى "انطلقت الرحلة" لا "حدث خطأ"

---

## B8 — قيود `buses`

خطر عملي: `bus_type` نص غير مقيّد بينما zod يتوقع `["عادي","VIP"]`. نوع ثالث يُفشل parse **المصفوفة كلها** → `/search` يعرض شاشة خطأ لكل رحلات تلك الشركة، لا بطاقة واحدة.

```
اتبع قواعد EXECUTION_MAP §0. Backend task — produce the migration FILE only, apply nothing.

Two unconstrained columns can blank an entire page:
  buses.bus_type is plain text, but src/features/search/schemas.ts requires z.enum(["عادي","VIP"]).
  buses.layout is plain jsonb, but seatMapSchema requires {rows, cols, aisleAfterCol}.
create_bus validates the layout, but nothing guards rows written any other way.

1. `supabase migration new buses_constraints` — add:
   - CHECK on bus_type limited to the two values in the zod enum
   - CHECK on layout: rows, cols, aisleAfterCol all present and integer
2. The migration MUST be safe against existing seed rows. Include a comment showing the SELECT that
   proves current rows pass, so I can run it before applying the constraint.
3. Make the file idempotent-safe to paste twice (if not exists / drop constraint if exists first) —
   it is applied by hand via the SQL editor.
4. Add a numbered step block for it at the end of docs/MANUAL_MIGRATION_RUNBOOK.md in the same
   format as the existing five: path, paste warning, version-recording insert, verification query,
   likely error.

NOT in this task: applying it, touching src/, seed.sql, or any RPC.
```

**الوكيل:** يعرض الملف + خطوة الـ runbook
**أنت:** شغّل SELECT الفحص → الصق الملف → سجّل النسخة → `npx vitest run -c vitest.db.config.ts tests/db/catalog.test.ts`

---

## F2 — E4: التذاكر + استرجاع PNR

```
اتبع قواعد EXECUTION_MAP §0.

Task E4 per docs/FRONTEND_REMAINING.md — the last passenger-facing gap. User stories PAS-10, PAS-11.
Backend is live: lookup_booking, get_booking, cancel_booking, and bookings-mine via RLS all exist
on DEV and are covered by tests/db/booking.test.ts.

FILES (create): src/app/(passenger)/tickets/page.tsx · tickets/[id]/page.tsx ·
tickets/lookup/page.tsx · src/features/tickets/api.ts + schemas.ts + hooks
FILES (edit): src/mocks/handlers.ts (remove the lookup handler) · the header nav component

1. /tickets — supabase.from("bookings"), RLS scopes it to the anonymous session. Tabs القادمة/السابقة,
   newest first, paginated. Empty state explains tickets are per-device and links to /tickets/lookup.
2. /tickets/[id] — full ticket with QR. REUSE the confirmation components; do not rebuild them.
3. /tickets/lookup — PNR (6 chars, uppercased on input) + phone (+9639XXXXXXXX) → lookup_booking.
   NOT_FOUND → "تأكد من رقم الحجز ورقم الهاتف". NEVER reveal which field was wrong (PAS-11 AC-2).
4. Cancel button on the ticket, hidden when departure is under the cancel window. cancel_booking
   returns CANCEL_WINDOW_CLOSED — handle it by name.
5. Header "رحلاتي" links to lookup when the local list is empty. Remove any passenger-auth placeholder.
6. Remove POST /api/bookings/lookup from src/mocks/handlers.ts. If handlers.ts is then empty of
   routes, say so and stop — do NOT delete the MSW wiring in this task.

Argument names are p_-prefixed. Verify each against supabase/migrations/ — note get_booking takes
p_id while cancel_booking takes p_booking_id. Do not assume symmetry.

NOT in this task: operator/admin screens, redesign, new dependencies, touching the booking flow.
```

**الوكيل:** `tsc` · `lint`
**أنت:** `npm run build` · احجز → `/tickets` تعرضه → افتح `/tickets/lookup` في متصفح آخر بـ PNR + هاتف → تظهر التذكرة · جرّب هاتفاً خاطئاً → نفس رسالة NOT_FOUND

---

## QA-2 — QA الانتقال

راجع `docs/QA_PHASE_E_CUTOVER.md`. هذه الحالات لم يستطع MSW محاكاتها إطلاقاً — أول تنفيذ فعلي لها.

---

## B9 — Admin RPCs

```
اتبع قواعد EXECUTION_MAP §0. Backend task — migration FILE only, apply nothing.

docs/BACKEND_V1.md §6 is documented but 0% implemented — no migration, no test, no route.
Two P0 test cases (V1_TEST_PLAN T-ADM1-2, T-ADM-SEC) depend on it.

1. `supabase migration new admin_rpcs` implementing §6. Every function requires the admin role claim.
   Remember the claim is `user_role`, NOT `role` — GoTrue owns `role` (see the comment in
   20260725202100_schema_rls_hook.sql).
     set_company_status(pending|approved|suspended)
     set_commission_rate — the 0.20–0.35 CHECK must surface as VALIDATION_ERROR, never a raw exception
     commissions_by_month(month) — per-company totals over SNAPSHOTTED rates
     city/route delete guarded: blocked with an explanation when future published trips exist
2. tests/db/admin.test.ts: non-admin → FORBIDDEN on every function · commission snapshot regression
   (change a rate → old bookings' math unchanged in both operator_summary and commissions_by_month) ·
   suspension removes trips from the next search_trips call.
3. Add the runbook step block, same format as the existing entries.

NOT in this task: applying it, admin UI, src/.
```

**الوكيل:** يعرض الملف + التستات + خطوة الـ runbook
**أنت:** الصق → سجّل النسخة → `npx vitest run -c vitest.db.config.ts tests/db/admin.test.ts`

---

## B10 — عمود `payment_status`

عيب مخفي: `get_manifest` يشتق حالة الدفع من `checked_in_at` — لا يوجد عمود دفع أصلاً. المشغّل يرى "غير مدفوع" لراكب دفع ولم يصعد بعد. أصلحه **قبل** بناء شاشة المانيفست.

```
اتبع قواعد EXECUTION_MAP §0. Backend task — migration FILE only, apply nothing.

get_manifest currently derives paymentStatus from checked_in_at (20260727160000_operator_rpcs.sql).
There is no payment column, so an operator sees "unpaid" for a passenger who paid but has not boarded.
Payment is cash-at-office in v1 (BACKEND_V1 §4), so it is a real, separate fact.

1. `supabase migration new booking_payment_status` — add bookings.payment_status with a CHECK
   (unpaid|paid), default unpaid, plus an RPC for the operator to mark a booking paid
   (own-company only, same role guard as the other operator RPCs).
2. Update get_manifest to read the column instead of inferring it. Keep the output field name
   `paymentStatus` — do not change the wire shape.
3. Update docs/BACKEND_V1.md §5 and §8 in the same change.
4. Extend tests/db/operator.test.ts: manifest shows unpaid by default · marking paid changes only
   that booking · another company's booking → NOT_FOUND.
5. Add the runbook step block.

NOT in this task: applying it, operator UI, changing check_in behaviour.
```

**الوكيل:** يعرض الملف + خطوة الـ runbook
**أنت:** الصق → `npx vitest run -c vitest.db.config.ts tests/db/operator.test.ts`

---

## F3 — Phase D: بوابة المشغّل (مقلَّصة)

> **قرار منتج قبل البدء.** `USER_STORIES.md` يضع خمس قصص للمشغّل في v1. عملياً **OPR-0 + OPR-3 وحدهما — تسجيل دخول + مانيفست + مسح QR — يكفيان لتشغيل خط باص حقيقي.** trips CRUD وbuses وreports تنتظر v1.1؛ المدير ينشئ الرحلات مؤقتاً. هذا يقصّر الطريق للإطلاق بأيام. الباك جاهز للاثنين، فالقرار قرارك.

نفّذها **على ثلاث جلسات**، لا واحدة:

**F3a — تسجيل الدخول والحارس**
```
اتبع قواعد EXECUTION_MAP §0.

OPR-0. Operator login, email + password (Supabase Auth). No self-signup — accounts are seeded.
FILES: src/app/operator/login/page.tsx · src/app/operator/layout.tsx · src/features/auth/*

The session JWT carries `user_role` and `company_id` (injected by the custom access token hook).
The claim is `user_role`, NOT `role`. Guard /operator/* : a non-operator is redirected to login
with no data flash.

NOT in this task: any operator screen beyond login, admin, trips CRUD.
```
**أنت:** سجّل دخولاً بحساب البذرة · افتح `/operator` كمجهول → إعادة توجيه بلا وميض بيانات

**F3b — المانيفست**
```
اتبع قواعد EXECUTION_MAP §0.

OPR-3 AC-1 + AC-4. FILES: src/app/operator/trips/page.tsx · trips/[id]/page.tsx ·
src/features/operator/{api.ts,schemas.ts,hooks}

Today's trips with occupancy %, then a manifest per trip via get_manifest: seat, name, gender,
phone, paymentStatus, checkedInAt. Plus operator_cancel_booking from the manifest with a
confirmation dialog naming the passenger and seats (the no-show mitigation for guest bookings).

Tenant isolation is enforced INSIDE the RPCs, not by RLS on every table — BACKEND_V1 §5 overstates
this. Do NOT read buses or routes directly via PostgREST expecting them to be company-scoped;
they are not.

NOT in this task: QR scanning, trips CRUD, buses, reports.
```
**أنت:** المانيفست يعرض ركاب حجزك التجريبي · الإلغاء يحرّر المقعد على الخريطة العامة

**F3c — مسح QR**
```
اتبع قواعد EXECUTION_MAP §0.

OPR-3 AC-2 + AC-3. FILES: src/app/operator/trips/[id]/ (scanner component) · operator api.ts

Camera QR scan → check_in(p_qr_payload). Valid: green + name + seat. Invalid, tampered, or another
company's ticket: red with the reason. Manual fallback by PNR via check_in_by_pnr.
check_in returns a passengers ARRAY (one QR per booking, N passengers) — not a single passenger.
Re-scan returns already-checked-in with checkedInAt in details; render the timestamp.

NOT in this task: trips CRUD, buses, reports, admin.
```
**أنت:** امسح QR تذكرة حقيقية بكاميرا الهاتف · أعد المسح → رسالة "مسجّل مسبقاً" بالوقت

---

## F4 — واجهة الإدارة

```
اتبع قواعد EXECUTION_MAP §0.

ADM-1..3. FILES: src/app/admin/{login,companies,cities,bookings}/page.tsx ·
src/features/admin/{api.ts,schemas.ts,hooks}

Companies approve/suspend + commission rate (0.20–0.35, VALIDATION_ERROR outside it).
Cities/routes CRUD with the delete guard surfaced as a readable Arabic explanation.
Bookings overview filterable by company/date + monthly commission totals.
Reuse the operator login pattern from F3a; the claim is `user_role` = admin, no company_id.

NOT in this task: operator screens, passenger flow, new dependencies.
```

**أنت:** علّق شركة → ابحث فوراً → رحلاتها تختفي

---

## INF — الإطلاق

قائمة `V1_TEST_PLAN §11`. البنود التي تحتاج قراراً منك:

- **مشروع PROD** — `supabase migration up` فقط، **لا `db reset` أبداً**. طبّق الـ13+ بنفس إجراء الـ runbook.
- **سر Vault** لـ QR HMAC — يُضبط يدوياً في PROD، وبدونه `create_booking` يرفع استثناء.
- **تدوير بيانات البذرة** — حسابات `Password123!` لا تصل PROD.
- **إعدادات الداشبورد** على PROD: تسجيل مجهول ON · تسجيل بريد جديد OFF · تأكيد بريد OFF.
- **تدريب استعادة** نسخة احتياطية مرة واحدة، ووثّق الزمن.
- **k6** — `tools/load/` جاهز وغير مُشغَّل قط.
- **5 دورات CI خضراء متتالية** — أعد تفعيل CI على push قبل الإطلاق.

---

## 3. مبادئ البرومبتات

1. مهمة واحدة لكل جلسة. الملفات مذكورة صراحةً، ≤6.
2. أشِر إلى الوثائق بالمسار — الوكيل يقرأها. **لا تلصق عقوداً في برومبت أبداً.**
3. اذكر دائماً ما **لا** يُبنى.
4. الباكيند = ملف migration فقط. أنت تطبّقه.
5. ناتج خاطئ → `git checkout` وأعد بالبرومبت مشدوداً. لا ترقّع مهمة فاشلة بمتابعات في نفس الجلسة.
6. لا تقبل "PASS" على ما لم يستطع الوكيل تشغيله.