-- B1 seed — idempotent (fixed uuids + ON CONFLICT DO NOTHING).
-- Mirrors src/mocks/data.ts so the frontend sees the same world when mocks go off:
-- identical city/company/trip UUIDs, identical 12x4 layout (aisleAfterCol 2),
-- the same tomorrow trips + departed (n=13) + fully-booked (n=14) fixtures.
--
-- Seeded credentials (documented in README): all accounts use password
--   Password123!
--   operator.amana@naql.dev   → operator, company الأمانة
--   operator.kadmous@naql.dev → operator, company القدموس
--   operator.ahlia@naql.dev   → operator, company الأهلية
--   admin@naql.dev            → admin
--   passenger.demo@naql.dev   → owns the seeded fully-booked trip

-- ===========================================================================
-- Cities (uuid("c1", n) from the mock)
-- ===========================================================================
insert into public.cities (id, name_ar, name_en, slug) values
  ('000000c1-0000-4000-8000-000000000001', 'دمشق',      'Damascus',    'damascus'),
  ('000000c1-0000-4000-8000-000000000002', 'حلب',       'Aleppo',      'aleppo'),
  ('000000c1-0000-4000-8000-000000000003', 'حمص',       'Homs',        'homs'),
  ('000000c1-0000-4000-8000-000000000004', 'اللاذقية',  'Latakia',     'latakia'),
  ('000000c1-0000-4000-8000-000000000005', 'دير الزور', 'Deir ez-Zor', 'deir-ez-zor'),
  ('000000c1-0000-4000-8000-000000000006', 'طرطوس',     'Tartus',      'tartus')
on conflict (id) do nothing;

-- ===========================================================================
-- Companies (uuid("a1", n) from the mock) — 1..3 approved. 4 is a pending
-- company used only by the RLS test (must be invisible to the public).
-- ===========================================================================
insert into public.companies (id, name, logo_url, status, commission_rate, rating) values
  ('000000a1-0000-4000-8000-000000000001', 'الأمانة', '/logos/al-amana.png',   'approved', 0.250, 4.6),
  ('000000a1-0000-4000-8000-000000000002', 'القدموس', '/logos/al-kadmous.png', 'approved', 0.300, 4.8),
  ('000000a1-0000-4000-8000-000000000003', 'الأهلية', '/logos/al-ahlia.png',   'approved', 0.200, 4.2),
  ('000000a1-0000-4000-8000-000000000004', 'شركة قيد المراجعة', null,           'pending',  0.250, null)
on conflict (id) do nothing;

-- ===========================================================================
-- Routes (forward + a few returns for the 2-week schedule)
-- ===========================================================================
insert into public.routes (id, from_city_id, to_city_id, default_duration_min) values
  ('000000e2-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000002', 300), -- دمشق→حلب
  ('000000e2-0000-4000-8000-000000000002', '000000c1-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000003', 120), -- دمشق→حمص
  ('000000e2-0000-4000-8000-000000000003', '000000c1-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000004', 240), -- دمشق→اللاذقية
  ('000000e2-0000-4000-8000-000000000004', '000000c1-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000006', 180), -- دمشق→طرطوس
  ('000000e2-0000-4000-8000-000000000005', '000000c1-0000-4000-8000-000000000001', '000000c1-0000-4000-8000-000000000005', 420), -- دمشق→دير الزور
  ('000000e2-0000-4000-8000-000000000011', '000000c1-0000-4000-8000-000000000002', '000000c1-0000-4000-8000-000000000001', 300), -- حلب→دمشق
  ('000000e2-0000-4000-8000-000000000012', '000000c1-0000-4000-8000-000000000003', '000000c1-0000-4000-8000-000000000001', 120), -- حمص→دمشق
  ('000000e2-0000-4000-8000-000000000013', '000000c1-0000-4000-8000-000000000004', '000000c1-0000-4000-8000-000000000001', 240)  -- اللاذقية→دمشق
on conflict (id) do nothing;

-- ===========================================================================
-- Buses — 2 per company (VIP + عادي), 12x4 layout, aisleAfterCol 2.
-- Bus id pattern 000000b1-…-0<company><type>  (type 1=VIP, 2=عادي)
-- ===========================================================================
insert into public.buses (id, company_id, plate_number, bus_type, layout) values
  ('000000b1-0000-4000-8000-000000000011', '000000a1-0000-4000-8000-000000000001', 'DAM-1101', 'VIP',  '{"rows":12,"cols":4,"aisleAfterCol":2}'),
  ('000000b1-0000-4000-8000-000000000012', '000000a1-0000-4000-8000-000000000001', 'DAM-1102', 'عادي', '{"rows":12,"cols":4,"aisleAfterCol":2}'),
  ('000000b1-0000-4000-8000-000000000021', '000000a1-0000-4000-8000-000000000002', 'DAM-2101', 'VIP',  '{"rows":12,"cols":4,"aisleAfterCol":2}'),
  ('000000b1-0000-4000-8000-000000000022', '000000a1-0000-4000-8000-000000000002', 'DAM-2102', 'عادي', '{"rows":12,"cols":4,"aisleAfterCol":2}'),
  ('000000b1-0000-4000-8000-000000000031', '000000a1-0000-4000-8000-000000000003', 'DAM-3101', 'VIP',  '{"rows":12,"cols":4,"aisleAfterCol":2}'),
  ('000000b1-0000-4000-8000-000000000032', '000000a1-0000-4000-8000-000000000003', 'DAM-3102', 'عادي', '{"rows":12,"cols":4,"aisleAfterCol":2}')
on conflict (id) do nothing;

-- ===========================================================================
-- Auth accounts (seed-safe: direct auth.users + auth.identities rows).
-- Password for ALL seeded accounts: Password123!
-- ===========================================================================
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  is_sso_user, is_anonymous,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')), now(),
  now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  false, false, '', '', '', ''
from (values
  ('000000d0-0000-4000-8000-000000000001'::uuid, 'operator.amana@naql.dev'),
  ('000000d0-0000-4000-8000-000000000002'::uuid, 'operator.kadmous@naql.dev'),
  ('000000d0-0000-4000-8000-000000000003'::uuid, 'operator.ahlia@naql.dev'),
  ('000000da-0000-4000-8000-000000000001'::uuid, 'admin@naql.dev'),
  ('000000db-0000-4000-8000-000000000001'::uuid, 'passenger.demo@naql.dev')
) as u(id, email)
on conflict (id) do nothing;

insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email', now(), now(), now()
from (values
  ('000000d0-0000-4000-8000-000000000001'::uuid, 'operator.amana@naql.dev'),
  ('000000d0-0000-4000-8000-000000000002'::uuid, 'operator.kadmous@naql.dev'),
  ('000000d0-0000-4000-8000-000000000003'::uuid, 'operator.ahlia@naql.dev'),
  ('000000da-0000-4000-8000-000000000001'::uuid, 'admin@naql.dev'),
  ('000000db-0000-4000-8000-000000000001'::uuid, 'passenger.demo@naql.dev')
) as u(id, email)
on conflict (provider_id, provider) do nothing;

-- Profiles (operators scoped to their company; admin global). No profile for
-- the demo passenger → the access-token hook gives it role 'passenger'.
insert into public.profiles (id, role, company_id) values
  ('000000d0-0000-4000-8000-000000000001', 'operator', '000000a1-0000-4000-8000-000000000001'),
  ('000000d0-0000-4000-8000-000000000002', 'operator', '000000a1-0000-4000-8000-000000000002'),
  ('000000d0-0000-4000-8000-000000000003', 'operator', '000000a1-0000-4000-8000-000000000003'),
  ('000000da-0000-4000-8000-000000000001', 'admin',    null)
on conflict (id) do nothing;

-- ===========================================================================
-- Trips.
-- Departure is Syria-local wall-clock converted to UTC via 'Asia/Damascus'.
-- The 12 tomorrow trips + departed(13) + full(14) mirror the mock (e1 uuids);
-- 15 is a DRAFT fixture for the RLS test.
-- ===========================================================================
insert into public.trips (id, company_id, route_id, bus_id, departure_at, arrival_at, price, status)
select
  ('000000e1-0000-4000-8000-' || lpad(t.n::text, 12, '0'))::uuid,
  t.company_id, t.route_id, t.bus_id,
  dep.departure_at,
  dep.departure_at + make_interval(mins => t.dur),
  t.price, t.status::public.trip_status
from (values
  --  n, company,                                     route,                                        bus,                                          day,  h, mi, dur, price,  status
  ( 1, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000011'::uuid,  1,  7,  0, 300, 110000, 'published'),
  ( 2, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000022'::uuid,  1,  9, 30, 315,  85000, 'published'),
  ( 3, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000031'::uuid,  1, 14,  0, 300, 115000, 'published'),
  ( 4, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000022'::uuid,  1, 22, 30, 330,  90000, 'published'),
  ( 5, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000012'::uuid,  1,  6, 30, 120,  60000, 'published'),
  ( 6, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000022'::uuid,  1, 11,  0, 120,  65000, 'published'),
  ( 7, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000031'::uuid,  1, 16, 30, 105,  75000, 'published'),
  ( 8, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000012'::uuid,  1, 19,  0, 120,  62000, 'published'),
  ( 9, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000021'::uuid,  1,  8,  0, 240, 100000, 'published'),
  (10, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000032'::uuid,  1, 10, 30, 255,  80000, 'published'),
  (11, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000011'::uuid,  1, 15,  0, 240, 105000, 'published'),
  (12, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000032'::uuid,  1, 18, 30, 270,  82000, 'published'),
  -- departed (yesterday) + fully-booked (tomorrow) + draft (tomorrow)
  (13, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000011'::uuid, -1,  8,  0, 300, 110000, 'published'),
  (14, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000021'::uuid,  1, 12,  0, 240, 100000, 'published'),
  (15, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000031'::uuid,  1, 13,  0, 120,  70000, 'draft')
) as t(n, company_id, route_id, bus_id, day, h, mi, dur, price, status)
cross join lateral (
  select ((current_date + t.day)::timestamp + make_interval(hours => t.h, mins => t.mi))
         at time zone 'Asia/Damascus' as departure_at
) dep
on conflict (id) do nothing;

-- 2 weeks of published trips: replay 6 daytime templates across days 2..14.
-- Deterministic md5 ids keep this idempotent.
insert into public.trips (id, company_id, route_id, bus_id, departure_at, arrival_at, price, status)
select
  md5('trip:' || t.n || ':' || d.day)::uuid,
  t.company_id, t.route_id, t.bus_id,
  dep.departure_at,
  dep.departure_at + make_interval(mins => t.dur),
  t.price, 'published'::public.trip_status
from (values
  ( 1, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000011'::uuid,  7,  0, 300, 110000),
  ( 2, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000001'::uuid, '000000b1-0000-4000-8000-000000000022'::uuid,  9, 30, 315,  85000),
  ( 5, '000000a1-0000-4000-8000-000000000001'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000012'::uuid,  6, 30, 120,  60000),
  ( 6, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000002'::uuid, '000000b1-0000-4000-8000-000000000022'::uuid, 11,  0, 120,  65000),
  ( 9, '000000a1-0000-4000-8000-000000000002'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000021'::uuid,  8,  0, 240, 100000),
  (10, '000000a1-0000-4000-8000-000000000003'::uuid, '000000e2-0000-4000-8000-000000000003'::uuid, '000000b1-0000-4000-8000-000000000032'::uuid, 10, 30, 255,  80000)
) as t(n, company_id, route_id, bus_id, h, mi, dur, price)
cross join generate_series(2, 14) as d(day)
cross join lateral (
  select ((current_date + d.day)::timestamp + make_interval(hours => t.h, mins => t.mi))
         at time zone 'Asia/Damascus' as departure_at
) dep
on conflict (id) do nothing;

-- ===========================================================================
-- Fully-booked trip (n=14): all 48 seats booked, alternating genders, owned by
-- the demo passenger. Gives the frontend a real full-map + gender demo.
-- ===========================================================================
insert into public.bookings (
  id, trip_id, user_id, pnr, status, payment_method, total_price, commission_rate, idempotency_key
)
select
  '000000e9-0000-4000-8000-000000000014',
  '000000e1-0000-4000-8000-000000000014',
  '000000db-0000-4000-8000-000000000001',
  'SEEDFL', 'confirmed'::public.booking_status, 'cash',
  100000 * 48,
  (select commission_rate from public.companies where id = '000000a1-0000-4000-8000-000000000002'),
  '000000e9-0000-4000-8000-000000000014'
on conflict (id) do nothing;

insert into public.booking_passengers (booking_id, trip_id, seat_number, full_name, phone, gender, active)
select
  '000000e9-0000-4000-8000-000000000014',
  '000000e1-0000-4000-8000-000000000014',
  s::text,
  'راكب ' || s,
  '+9639' || lpad(s::text, 8, '0'),
  (case when s % 2 = 0 then 'female' else 'male' end)::public.gender,
  true
from generate_series(1, 48) as s
on conflict (trip_id, seat_number) where active do nothing;
