-- B3 / M3: Seat map + locking (BACKEND_V1 §3). Highest-risk code in the product.
-- Reference implementation: src/mocks/handlers.ts (field-for-field).
--
-- All three are SECURITY DEFINER: seat_locks / seat_lock_seats / booking_passengers
-- are RLS-denied to clients, so a public caller cannot read lock/booking state
-- directly. These functions read it on their behalf — which is exactly why the
-- published + approved-company filters INSIDE each function are the security
-- boundary, not RLS. Never remove them.

-- ===========================================================================
-- Access paths are already index-backed (no new index needed):
--   booking_passengers  → partial unique (trip_id, seat_number) WHERE active
--                         serves "active rows for a trip" (leftmost column).
--   seat_lock_seats     → unique (trip_id, seat_number) serves "locks for a trip".
--   seat_locks          → pk(id) for the join; seat_locks_expires_at_idx for TTL.
-- ===========================================================================

-- ===========================================================================
-- get_seat_map(p_trip_id) → bare §3 object { layout, seats:[{number,row,col,status,gender?}] }.
-- status priority: booked > locked > available. gender key present ONLY on
-- locked/booked seats (absent, never null, on available). Seats derive from the
-- bus layout rows×cols — there is no seat table. Returns null for a trip that is
-- not a published trip of an approved company (the security boundary).
-- ===========================================================================
create or replace function public.get_seat_map(p_trip_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    -- published + approved is the security boundary (SECURITY DEFINER bypasses RLS).
    -- No departure_at filter: a departed-but-published trip still shows its map.
    select b.layout
    from trips t
    join companies c on c.id = t.company_id
    join buses     b on b.id = t.bus_id
    where t.id = p_trip_id
      and t.status = 'published'
      and c.status = 'approved'
  ),
  dims as (
    select layout,
           (layout->>'rows')::int as rows,
           (layout->>'cols')::int as cols
    from visible
  ),
  grid as (
    select (r * d.cols + c + 1) as n, r as row, c as col
    from dims d,
         generate_series(0, d.rows - 1) as r,
         generate_series(0, d.cols - 1) as c
  ),
  booked as (
    select bp.seat_number, bp.gender
    from booking_passengers bp
    where bp.trip_id = p_trip_id and bp.active
  ),
  locked as (
    select sls.seat_number, sls.gender
    from seat_lock_seats sls
    join seat_locks sl on sl.id = sls.lock_id
    where sls.trip_id = p_trip_id and sl.expires_at > now()
  ),
  seats as (
    select
      g.n,
      jsonb_build_object(
        'number', g.n::text,
        'row', g.row,
        'col', g.col,
        'status', case
                    when bk.seat_number is not null then 'booked'
                    when lk.seat_number is not null then 'locked'
                    else 'available'
                  end
      )
      || case
           when bk.seat_number is not null then jsonb_build_object('gender', bk.gender)
           when lk.seat_number is not null then jsonb_build_object('gender', lk.gender)
           else '{}'::jsonb
         end as seat
    from grid g
    left join booked bk on bk.seat_number = g.n::text
    left join locked lk on lk.seat_number = g.n::text
  )
  select case
    when exists (select 1 from dims) then
      jsonb_build_object(
        'layout', (select layout from dims),
        'seats',  (select coalesce(jsonb_agg(seat order by n), '[]'::jsonb) from seats)
      )
    else null
  end;
$$;

revoke all on function public.get_seat_map(uuid) from public;
grant  execute on function public.get_seat_map(uuid) to anon, authenticated;

-- ===========================================================================
-- lock_seats(p_trip_id, p_seats=[{seatNumber,gender}]) → §0 envelope.
-- One transaction, exact order: auth → advisory lock → purge expired → trip
-- validity → seat/gender validation → conflict check → insert (all-or-nothing).
-- ===========================================================================
create or replace function public.lock_seats(p_trip_id uuid, p_seats jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_ttl       int;
  v_dep       timestamptz;
  v_rows      int;
  v_cols      int;
  v_capacity  int;
  v_invalid   text[];
  v_booked    text[];
  v_locked    text[];
  v_lock_id   uuid;
  v_expires   timestamptz;
begin
  -- a. auth required (anonymous sessions are fine — they have an auth.uid()).
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required to hold seats', 'details', null));
  end if;

  -- b. serialize all lockers of this trip.
  perform pg_advisory_xact_lock(hashtext(p_trip_id::text)::bigint);

  -- c. self-cleaning: drop expired locks for this trip (cascades seat_lock_seats).
  delete from seat_locks where trip_id = p_trip_id and expires_at <= now();

  -- d. trip must be a published trip of an approved company (else NOT_FOUND),
  --    and not yet departed (else TRIP_DEPARTED).
  select t.departure_at, (b.layout->>'rows')::int, (b.layout->>'cols')::int
    into v_dep, v_rows, v_cols
  from trips t
  join companies c on c.id = t.company_id
  join buses     b on b.id = t.bus_id
  where t.id = p_trip_id
    and t.status = 'published'
    and c.status = 'approved';

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null));
  end if;

  if v_dep <= now() then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'TRIP_DEPARTED', 'message', 'Trip has already departed', 'details', null));
  end if;

  v_capacity := v_rows * v_cols;

  -- e. validate the request: non-empty; every seatNumber is in the layout;
  --    every gender is a valid enum. Any violation → VALIDATION_ERROR, lock nothing.
  if p_seats is null or jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) = 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'No seats requested', 'details', null));
  end if;

  select array_agg(x.seat_number order by x.ord)
    into v_invalid
  from (
    select value->>'seatNumber' as seat_number,
           value->>'gender'      as gender,
           ordinality            as ord,
           case when (value->>'seatNumber') ~ '^[0-9]+$'
                then (value->>'seatNumber')::int end as seat_int
    from jsonb_array_elements(p_seats) with ordinality
  ) x
  where x.seat_int is null
     or x.seat_int < 1
     or x.seat_int > v_capacity
     or x.gender is null
     or x.gender not in ('male', 'female');

  if v_invalid is not null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Invalid seat selection',
      'details', jsonb_build_object('seats', to_jsonb(v_invalid))));
  end if;

  -- f. conflicts = requested ∩ (booked ∪ locked). Booked takes precedence
  --    (matches handlers.ts). details.seats = exactly those, in request order.
  select array_agg(x.seat_number order by x.ord)
    into v_booked
  from (
    select value->>'seatNumber' as seat_number, ordinality as ord
    from jsonb_array_elements(p_seats) with ordinality
  ) x
  where x.seat_number in (
    select seat_number from booking_passengers where trip_id = p_trip_id and active
  );

  if v_booked is not null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'SEAT_ALREADY_BOOKED', 'message', 'Some seats are already booked',
      'details', jsonb_build_object('seats', to_jsonb(v_booked))));
  end if;

  select array_agg(x.seat_number order by x.ord)
    into v_locked
  from (
    select value->>'seatNumber' as seat_number, ordinality as ord
    from jsonb_array_elements(p_seats) with ordinality
  ) x
  where x.seat_number in (
    select seat_number from seat_lock_seats where trip_id = p_trip_id
  );

  if v_locked is not null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'SEAT_ALREADY_LOCKED', 'message', 'Some seats were just taken',
      'details', jsonb_build_object('seats', to_jsonb(v_locked))));
  end if;

  -- g. insert. The UNIQUE(trip_id, seat_number) on seat_lock_seats is the final
  --    guarantee: a race that slips past (f) fails the constraint → mapped to
  --    SEAT_ALREADY_LOCKED, transaction rolls back → nothing partially locked.
  select ((value)::text)::int into v_ttl from app_config where key = 'lock_ttl_minutes';

  begin
    insert into seat_locks (trip_id, owner_id, expires_at)
    values (p_trip_id, v_uid, now() + make_interval(mins => v_ttl))
    returning id, expires_at into v_lock_id, v_expires;

    insert into seat_lock_seats (lock_id, trip_id, seat_number, gender)
    select v_lock_id, p_trip_id, x.seat_number, (x.gender)::public.gender
    from (
      select value->>'seatNumber' as seat_number, value->>'gender' as gender
      from jsonb_array_elements(p_seats)
    ) x;
  exception when unique_violation then
    select array_agg(x.seat_number order by x.ord)
      into v_locked
    from (
      select value->>'seatNumber' as seat_number, ordinality as ord
      from jsonb_array_elements(p_seats) with ordinality
    ) x
    where x.seat_number in (
      select seat_number from seat_lock_seats where trip_id = p_trip_id
    );
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'SEAT_ALREADY_LOCKED', 'message', 'Some seats were just taken',
      'details', jsonb_build_object('seats', coalesce(to_jsonb(v_locked), '[]'::jsonb))));
  end;

  -- h. success
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'lockId', v_lock_id,
    'expiresAt', to_char(v_expires at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
end;
$$;

revoke all on function public.lock_seats(uuid, jsonb) from public;
grant  execute on function public.lock_seats(uuid, jsonb) to anon, authenticated;

-- ===========================================================================
-- release_lock(p_lock_id) → §0 envelope. Owner-only (else FORBIDDEN).
-- Idempotent: releasing a lock that is already gone still returns ok.
-- ===========================================================================
create or replace function public.release_lock(p_lock_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  select owner_id into v_owner from seat_locks where id = p_lock_id;

  if not found then
    -- already gone → idempotent success
    return jsonb_build_object('ok', true, 'data', null);
  end if;

  if v_owner is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Not your lock', 'details', null));
  end if;

  delete from seat_locks where id = p_lock_id;  -- cascades seat_lock_seats
  return jsonb_build_object('ok', true, 'data', null);
end;
$$;

revoke all on function public.release_lock(uuid) from public;
grant  execute on function public.release_lock(uuid) to anon, authenticated;
