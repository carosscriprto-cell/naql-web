-- M0: base enums + app_config table (BACKEND_EXECUTION_PLAN M0, BACKEND_V1 §0).
-- No domain tables here — those arrive in B1 (§8).

-- ---------------------------------------------------------------------------
-- Enums (shared across the schema; created here so later migrations can use them)
-- ---------------------------------------------------------------------------
create type public.gender          as enum ('male', 'female');
create type public.trip_status     as enum ('draft', 'published', 'cancelled');
create type public.booking_status  as enum ('confirmed', 'cancelled');
create type public.company_status  as enum ('pending', 'approved', 'suspended');

-- ---------------------------------------------------------------------------
-- app_config — all TTL/window/limit values live here, read inside RPCs.
-- Never hardcode 10 / 2 / 4 literals in functions (CLAUDE.md).
-- ---------------------------------------------------------------------------
create table public.app_config (
  key   text  primary key,
  value jsonb not null
);

comment on table public.app_config is
  'Runtime configuration read inside SECURITY DEFINER RPCs. Not exposed to clients (RLS deny-by-default).';

insert into public.app_config (key, value) values
  ('lock_ttl_minutes',                     '10'::jsonb),
  ('cancel_window_hours',                  '2'::jsonb),
  ('max_active_bookings_per_user',         '4'::jsonb),
  ('max_active_bookings_per_phone_per_trip','4'::jsonb);

-- Deny-by-default: RLS on, no policies. RPCs are SECURITY DEFINER so they still read it.
alter table public.app_config enable row level security;
