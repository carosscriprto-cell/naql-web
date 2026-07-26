-- B1 / M1: full domain schema + RLS + Custom Access Token Hook.
-- Contract: docs/BACKEND_V1.md §8. Enums + app_config already exist (migration 1).
-- No RPCs here (B2+). No write policies on core tables — writes go through RPCs.

-- ===========================================================================
-- Tables (dependency order)
-- ===========================================================================

-- Operators/admins only. Passengers stay anonymous auth.users with no profile
-- row → the access-token hook gives them role 'passenger'.
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('operator', 'admin')),
  company_id uuid,               -- FK added after companies exists
  created_at timestamptz not null default now(),
  -- operators are scoped to a company; admins are global
  constraint profiles_company_scope check (
    (role = 'operator' and company_id is not null) or
    (role = 'admin'    and company_id is null)
  )
);

create table public.cities (
  id      uuid primary key default gen_random_uuid(),
  name_ar text not null,
  name_en text not null,
  slug    text not null unique
);

create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  logo_url        text,
  status          public.company_status not null default 'pending',
  commission_rate numeric(4, 3) not null default 0.200
                    check (commission_rate between 0.20 and 0.35),
  rating          numeric(2, 1),
  created_at      timestamptz not null default now()
);

-- profiles.company_id → companies (added now that companies exists)
alter table public.profiles
  add constraint profiles_company_id_fkey
  foreign key (company_id) references public.companies (id) on delete restrict;

create table public.routes (
  id                   uuid primary key default gen_random_uuid(),
  from_city_id         uuid not null references public.cities (id),
  to_city_id           uuid not null references public.cities (id),
  default_duration_min int  not null check (default_duration_min > 0),
  constraint routes_distinct_cities check (from_city_id <> to_city_id),
  unique (from_city_id, to_city_id)
);

create table public.buses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  plate_number text not null,
  bus_type     text not null,
  layout       jsonb not null,   -- { rows, cols, aisleAfterCol }
  unique (company_id, plate_number)
);

create table public.trips (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id),
  route_id     uuid not null references public.routes (id),
  bus_id       uuid not null references public.buses (id),
  departure_at timestamptz not null,
  arrival_at   timestamptz not null,
  price        int not null check (price >= 0),
  status       public.trip_status not null default 'draft',
  created_at   timestamptz not null default now(),
  constraint trips_arrival_after_departure check (arrival_at > departure_at)
);

create table public.seat_locks (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.seat_lock_seats (
  id          uuid primary key default gen_random_uuid(),
  lock_id     uuid not null references public.seat_locks (id) on delete cascade,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  seat_number text not null,
  gender      public.gender not null,
  -- one live lock per seat per trip — belt-and-suspenders for lock_seats (B3)
  unique (trip_id, seat_number)
);

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips (id),
  user_id           uuid not null references auth.users (id),
  pnr               text not null unique,
  status            public.booking_status not null default 'confirmed',
  payment_method    text not null,
  total_price       int  not null check (total_price >= 0),
  commission_rate   numeric(4, 3) not null,   -- snapshot from company at creation
  idempotency_key   uuid not null unique,
  response_snapshot jsonb,
  created_at        timestamptz not null default now()
);

create table public.booking_passengers (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  trip_id       uuid not null references public.trips (id),
  seat_number   text not null,
  full_name     text not null,
  phone         text not null,
  gender        public.gender not null,
  active        boolean not null default true,
  checked_in_at timestamptz
);

-- Double-booking is impossible at the DB level: at most one ACTIVE passenger
-- per (trip, seat). Cancelled rows (active=false) free the seat.
create unique index booking_passengers_active_seat_uq
  on public.booking_passengers (trip_id, seat_number)
  where active;

-- ===========================================================================
-- Indexes (§8 minimum + lock lookups)
-- ===========================================================================
create index trips_route_departure_status_idx on public.trips (route_id, departure_at, status);
create index bookings_trip_idx                 on public.bookings (trip_id);
create index bookings_user_idx                 on public.bookings (user_id);
create index booking_passengers_booking_idx    on public.booking_passengers (booking_id);
create index booking_passengers_phone_idx      on public.booking_passengers (phone);
-- pnr + idempotency_key already indexed via UNIQUE constraints.
create index seat_locks_trip_idx               on public.seat_locks (trip_id);
create index seat_locks_expires_at_idx         on public.seat_locks (expires_at);

-- ===========================================================================
-- Custom Access Token Hook — injects user_role + company_id claims.
--
-- NOTE ON CLAIM NAME: the contract sketch says auth.jwt()->>'role'. We do NOT
-- overwrite the standard `role` claim — GoTrue sets it to the Postgres role
-- ('authenticated'/'anon') and PostgREST does SET ROLE on it; writing 'operator'
-- there would break every request (no such DB role). We add `user_role` instead;
-- RLS/RPCs read auth.jwt()->>'user_role'. Passengers (no profile) → 'passenger'.
-- ===========================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  claims     jsonb;
  v_role     text;
  v_company  uuid;
begin
  select role, company_id into v_role, v_company
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  claims := coalesce(event -> 'claims', '{}'::jsonb);

  claims := jsonb_set(claims, '{user_role}', to_jsonb(coalesce(v_role, 'passenger')));

  if v_company is not null then
    claims := jsonb_set(claims, '{company_id}', to_jsonb(v_company));
  else
    claims := claims - 'company_id';
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook runs as the supabase_auth_admin role; grant it what it needs and
-- keep everyone else out (per Supabase docs).
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from anon, authenticated, public;
grant select on table public.profiles to supabase_auth_admin;

-- ===========================================================================
-- Row Level Security — enable on every table, deny-by-default.
-- No INSERT/UPDATE/DELETE policies anywhere: writes go through SECURITY DEFINER
-- RPCs (later tasks). Only SELECT policies here.
-- ===========================================================================
alter table public.profiles           enable row level security;
alter table public.cities             enable row level security;
alter table public.companies          enable row level security;
alter table public.routes             enable row level security;
alter table public.buses              enable row level security;
alter table public.trips              enable row level security;
alter table public.seat_locks         enable row level security;
alter table public.seat_lock_seats    enable row level security;
alter table public.bookings           enable row level security;
alter table public.booking_passengers enable row level security;

-- Helper expressions used below:
--   auth.uid()                         → current user id (also set for anonymous sign-ins)
--   auth.jwt()->>'user_role'           → 'passenger' | 'operator' | 'admin'
--   nullif(auth.jwt()->>'company_id','')::uuid → operator's company

-- profiles: self-read only. Plus the auth admin (for the hook).
create policy profiles_self_read on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_auth_admin_read on public.profiles
  for select to supabase_auth_admin
  using (true);

-- cities: public catalog.
create policy cities_public_read on public.cities
  for select to anon, authenticated
  using (true);

-- companies: only approved are public; admins see all; operator sees own.
create policy companies_public_read on public.companies
  for select to anon, authenticated
  using (
    status = 'approved'
    or (auth.jwt() ->> 'user_role') = 'admin'
    or id = nullif(auth.jwt() ->> 'company_id', '')::uuid
  );

-- buses: layout feeds the seat map → readable by everyone.
create policy buses_public_read on public.buses
  for select to anon, authenticated
  using (true);

-- trips: published future trips of approved companies are public; operators see
-- their own company's trips (any status); admins see all.
create policy trips_public_read on public.trips
  for select to anon, authenticated
  using (
    status = 'published'
    and departure_at > now()
    and exists (
      select 1 from public.companies c
      where c.id = trips.company_id and c.status = 'approved'
    )
  );

create policy trips_operator_read on public.trips
  for select to authenticated
  using (
    (auth.jwt() ->> 'user_role') = 'operator'
    and company_id = nullif(auth.jwt() ->> 'company_id', '')::uuid
  );

create policy trips_admin_read on public.trips
  for select to authenticated
  using ((auth.jwt() ->> 'user_role') = 'admin');

-- bookings: owner, operator of the trip's company, or admin.
create policy bookings_owner_read on public.bookings
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy bookings_operator_read on public.bookings
  for select to authenticated
  using (
    (auth.jwt() ->> 'user_role') = 'operator'
    and exists (
      select 1 from public.trips t
      where t.id = bookings.trip_id
        and t.company_id = nullif(auth.jwt() ->> 'company_id', '')::uuid
    )
  );

create policy bookings_admin_read on public.bookings
  for select to authenticated
  using ((auth.jwt() ->> 'user_role') = 'admin');

-- booking_passengers: same visibility as their parent booking.
create policy booking_passengers_owner_read on public.booking_passengers
  for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_passengers.booking_id
        and b.user_id = (select auth.uid())
    )
  );

create policy booking_passengers_operator_read on public.booking_passengers
  for select to authenticated
  using (
    (auth.jwt() ->> 'user_role') = 'operator'
    and exists (
      select 1 from public.trips t
      where t.id = booking_passengers.trip_id
        and t.company_id = nullif(auth.jwt() ->> 'company_id', '')::uuid
    )
  );

create policy booking_passengers_admin_read on public.booking_passengers
  for select to authenticated
  using ((auth.jwt() ->> 'user_role') = 'admin');

-- routes, seat_locks, seat_lock_seats: no SELECT policy → fully denied to
-- clients. Read only inside SECURITY DEFINER RPCs (later).

-- ===========================================================================
-- Grants — PostgREST honours RLS only after a table privilege is granted.
-- Publicly-readable tables → anon + authenticated. Owner/role-scoped tables →
-- authenticated only (anonymous passengers ARE the 'authenticated' role).
-- ===========================================================================
grant select on public.cities    to anon, authenticated;
grant select on public.companies to anon, authenticated;
grant select on public.buses     to anon, authenticated;
grant select on public.trips     to anon, authenticated;

grant select on public.profiles           to authenticated;
grant select on public.bookings            to authenticated;
grant select on public.booking_passengers  to authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;