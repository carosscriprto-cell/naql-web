-- E5 / post-launch: a Realtime signal for the seat map.
--
-- WHY NOT PUBLISH seat_lock_seats AND booking_passengers DIRECTLY.
-- Realtime replays changes through RLS: a subscriber receives a row only if it
-- could SELECT that row. Under the B1 policies:
--   · seat_lock_seats has NO select policy and NO grant to anon/authenticated
--     (20260725202100, "routes, seat_locks, seat_lock_seats: no SELECT policy →
--     fully denied to clients"). A subscription to it reports SUBSCRIBED and
--     then receives NOTHING, forever — a silent no-op that looks healthy, which
--     is worse than polling because no error ever fires the fallback.
--   · booking_passengers is scoped by booking_passengers_owner_read to the
--     caller's OWN bookings. A passenger would be notified only about seats
--     they already booked — precisely the events they do not need.
-- Widening those policies is not an option: RLS is row-level, so any policy
-- that lets an anonymous viewer observe occupancy on booking_passengers also
-- hands them full_name and phone for every passenger on every trip. There is no
-- column-level escape, and Realtime does not publish views.
--
-- THE SIGNAL INSTEAD. One tiny table carrying no passenger data at all: which
-- trip changed, and a counter. Triggers bump it whenever a hold or a booking
-- moves. Subscribers learn "trip X's seat map changed" and refetch — which is
-- exactly what a 15-second poller already infers, so this discloses nothing new.
-- The seat map itself keeps coming from get_seat_map, through RLS, as before.
--
-- WHAT THIS CANNOT SIGNAL: lock EXPIRY. A hold lapses because
-- `expires_at < now()`, with no row written and therefore no event. The client
-- keeps a slow poll for that case; see the comment in use-seat-map.ts.

-- ===========================================================================
-- 1. The version row. One per trip, created on first change.
-- ===========================================================================
create table public.trip_seat_map_version (
  trip_id    uuid primary key references public.trips (id) on delete cascade,
  revision   bigint      not null default 1,
  updated_at timestamptz not null default now()
);

comment on table public.trip_seat_map_version is
  'Realtime fan-out signal for the seat map. Deliberately carries NO passenger or lock data — subscribers refetch get_seat_map, which applies its own rules. See 20260728100000.';

-- ===========================================================================
-- 2. The trigger. SECURITY DEFINER so it writes regardless of who moved the
-- underlying row (an RPC running as the owner, or a service-role QA script).
-- ===========================================================================
create or replace function public.bump_seat_map_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip uuid;
begin
  -- NEW is unassigned on DELETE, so branch rather than coalesce across them.
  -- trip_id is immutable on both source tables in practice, so the UPDATE case
  -- only ever needs NEW.
  if tg_op = 'DELETE' then
    v_trip := old.trip_id;
  else
    v_trip := new.trip_id;
  end if;

  if v_trip is null then
    return null;
  end if;

  insert into public.trip_seat_map_version as v (trip_id, revision, updated_at)
  values (v_trip, 1, now())
  on conflict (trip_id) do update
    set revision   = v.revision + 1,
        updated_at = now();

  return null; -- AFTER trigger; the return value is ignored
end;
$$;

revoke all on function public.bump_seat_map_version() from public, anon, authenticated;

-- Row-level, not statement-level with transition tables: a statement-level
-- trigger would collapse a 4-seat lock into one bump, but needs separate
-- triggers per operation (OLD TABLE is only legal on UPDATE/DELETE). Row-level
-- is one declaration per table and the fan-out it causes — four row events for
-- a four-seat lock — is already handled by the client's 250ms debounce.
--
-- LOCK ORDERING. Both writers reach this row LAST: lock_seats holds its trip
-- advisory lock and its seat_lock_seats rows before the trigger fires, and
-- create_booking holds the seat_locks row (FOR UPDATE) before inserting
-- passengers. Neither ever takes the version row before those, so two writers
-- on the same trip queue on it rather than deadlocking.
create trigger seat_lock_seats_bump_seat_map_version
  after insert or update or delete on public.seat_lock_seats
  for each row execute function public.bump_seat_map_version();

create trigger booking_passengers_bump_seat_map_version
  after insert or update or delete on public.booking_passengers
  for each row execute function public.bump_seat_map_version();

-- ===========================================================================
-- 3. Readable by everyone; writable by nobody but the trigger.
--
-- `using (true)` is the whole point: an anonymous viewer must receive the
-- notification for any trip they are looking at. The row is (trip_id, counter,
-- timestamp) — a poller already learns all three by polling, so publishing it
-- adds no information. No INSERT/UPDATE/DELETE policy exists, so the only
-- writer is the SECURITY DEFINER trigger above.
-- ===========================================================================
alter table public.trip_seat_map_version enable row level security;

create policy trip_seat_map_version_public_read on public.trip_seat_map_version
  for select to anon, authenticated
  using (true);

grant select on public.trip_seat_map_version to anon, authenticated;

-- ===========================================================================
-- 4. Join the Realtime publication.
--
-- Guarded both ways: Supabase creates supabase_realtime on project setup, but a
-- from-zero `db reset` on a bare local stack may not have it yet, and re-adding
-- an already-published table is an error rather than a no-op.
--
-- REPLICA IDENTITY stays DEFAULT: the client filters on trip_id, which IS the
-- primary key, so it is present in the payload of every event type including
-- DELETE. Nothing here needs REPLICA IDENTITY FULL.
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename  = 'trip_seat_map_version'
  ) then
    alter publication supabase_realtime add table public.trip_seat_map_version;
  end if;
end $$;
