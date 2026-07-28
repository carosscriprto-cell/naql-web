-- B5 / M5: Operator RPCs (BACKEND_V1 §5).
--
-- TENANT ISOLATION IS THE POINT OF THIS FILE. Every function below is
-- SECURITY DEFINER, so RLS does not protect operator A from operator B — the
-- explicit company checks inside each function ARE the boundary. Never remove
-- them, and never widen a lookup to "by id" without re-asserting the company.
--
-- CLAIMS. The Custom Access Token Hook (20260725202100) injects `user_role`,
-- NOT `role`: GoTrue owns `role` (it holds the Postgres role PostgREST does
-- SET ROLE on), so writing 'operator' there would break every request. The
-- contract sketch in §5 says auth.jwt()->>'role'; the implementation reads
-- `user_role`. Company scope comes from the `company_id` claim, which the hook
-- copies from profiles.
--
-- ERROR MAPPING (§0 codes only — no new codes):
--   no session                     → UNAUTHORIZED
--   signed in but not an operator  → FORBIDDEN
--   ANOTHER COMPANY'S resource     → NOT_FOUND, never FORBIDDEN. FORBIDDEN
--     would confirm the row exists, which is precisely what a competitor
--     probing trip ids wants to learn (OPR-1 AC-3). Missing and not-yours are
--     deliberately indistinguishable.
--   bad input / illegal transition → VALIDATION_ERROR with details.field
-- Expected failures are RETURNED, never RAISEd.

-- ===========================================================================
-- 1. operator_trip_json — the shared operator-facing trip shape.
-- camelCase, mirrors §2 naming where the fields overlap. Internal helper:
-- every caller has already proven company ownership before calling it.
-- ===========================================================================
create or replace function public.operator_trip_json(p_trip_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'price', t.price,
    'departureAt', to_char(t.departure_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'arrivalAt',   to_char(t.arrival_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'route', jsonb_build_object(
      'id', r.id,
      'fromCity', jsonb_build_object('id', fc.id, 'nameAr', fc.name_ar),
      'toCity',   jsonb_build_object('id', tc.id, 'nameAr', tc.name_ar)
    ),
    'bus', jsonb_build_object(
      'id', b.id, 'plateNumber', b.plate_number, 'busType', b.bus_type, 'layout', b.layout
    ),
    'capacity', (b.layout->>'rows')::int * (b.layout->>'cols')::int,
    'bookedSeats', (
      select count(*)::int from booking_passengers bp
      where bp.trip_id = t.id and bp.active
    )
  )
  from trips t
  join routes r on r.id = t.route_id
  join cities fc on fc.id = r.from_city_id
  join cities tc on tc.id = r.to_city_id
  join buses  b on b.id = t.bus_id
  where t.id = p_trip_id;
$$;

revoke all on function public.operator_trip_json(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. create_trip — always DRAFT. Publishing is update_trip's job, so a trip
-- can never become searchable by accident on creation.
-- ===========================================================================
create or replace function public.create_trip(
  p_route_id     uuid,
  p_bus_id       uuid,
  p_departure_at timestamptz,
  p_arrival_at   timestamptz,
  p_price        int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := auth.jwt() ->> 'user_role';
  v_company uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_trip_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if p_price is null or p_price < 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Price must be a non-negative integer',
      'details', jsonb_build_object('field', 'price')));
  end if;

  if p_departure_at is null or p_arrival_at is null or p_arrival_at <= p_departure_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Arrival must be after departure',
      'details', jsonb_build_object('field', 'arrivalAt')));
  end if;

  if not exists (select 1 from routes where id = p_route_id) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Unknown route',
      'details', jsonb_build_object('field', 'routeId')));
  end if;

  -- Another company's bus is reported as missing, not forbidden.
  if not exists (select 1 from buses where id = p_bus_id and company_id = v_company) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Bus not found', 'details', null));
  end if;

  insert into trips (company_id, route_id, bus_id, departure_at, arrival_at, price, status)
  values (v_company, p_route_id, p_bus_id, p_departure_at, p_arrival_at, p_price, 'draft')
  returning id into v_trip_id;

  return jsonb_build_object('ok', true, 'data', public.operator_trip_json(v_trip_id));
end;
$$;

revoke all on function public.create_trip(uuid, uuid, timestamptz, timestamptz, int) from public, anon;
grant  execute on function public.create_trip(uuid, uuid, timestamptz, timestamptz, int) to authenticated;

-- ===========================================================================
-- 3. update_trip — price / times / status. Null argument = leave unchanged.
--
-- Publishing takes effect on the NEXT search_trips call: that function filters
-- on status at query time, so there is no cache or materialised view to
-- invalidate here (§2).
--
-- A price change deliberately does NOT touch existing bookings. Each booking
-- carries its own total_price and commission_rate, snapshotted at creation
-- (§4) — repricing a trip must never re-price a ticket someone already holds.
-- ===========================================================================
create or replace function public.update_trip(
  p_trip_id      uuid,
  p_price        int         default null,
  p_departure_at timestamptz default null,
  p_arrival_at   timestamptz default null,
  p_status       text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text := auth.jwt() ->> 'user_role';
  v_company   uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_departure timestamptz;
  v_arrival   timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  -- Company scope is part of the lookup, not a check after it.
  select t.departure_at, t.arrival_at into v_departure, v_arrival
  from trips t
  where t.id = p_trip_id and t.company_id = v_company;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null));
  end if;

  if p_status is not null and p_status not in ('draft', 'published', 'cancelled') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Unknown trip status',
      'details', jsonb_build_object('field', 'status')));
  end if;

  if p_price is not null and p_price < 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Price must be a non-negative integer',
      'details', jsonb_build_object('field', 'price')));
  end if;

  -- Validate the RESULTING window, not just the supplied halves.
  v_departure := coalesce(p_departure_at, v_departure);
  v_arrival   := coalesce(p_arrival_at,   v_arrival);
  if v_arrival <= v_departure then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Arrival must be after departure',
      'details', jsonb_build_object('field', 'arrivalAt')));
  end if;

  update trips t set
    price        = coalesce(p_price, t.price),
    departure_at = v_departure,
    arrival_at   = v_arrival,
    status       = coalesce(p_status::public.trip_status, t.status)
  where t.id = p_trip_id and t.company_id = v_company;

  return jsonb_build_object('ok', true, 'data', public.operator_trip_json(p_trip_id));
end;
$$;

revoke all on function public.update_trip(uuid, int, timestamptz, timestamptz, text) from public, anon;
grant  execute on function public.update_trip(uuid, int, timestamptz, timestamptz, text) to authenticated;

-- ===========================================================================
-- 4. cancel_trip — the trip and every confirmed booking on it.
-- Passengers go active=false, which frees their seats through the partial
-- unique index exactly the way cancel_booking does (§4).
-- ===========================================================================
create or replace function public.cancel_trip(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text := auth.jwt() ->> 'user_role';
  v_company   uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_cancelled int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if not exists (select 1 from trips where id = p_trip_id and company_id = v_company) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null));
  end if;

  -- Passengers first: the booking status drives which rows to deactivate.
  update booking_passengers bp set active = false
  where bp.trip_id = p_trip_id
    and bp.active
    and exists (
      select 1 from bookings b
      where b.id = bp.booking_id and b.status = 'confirmed'
    );

  with cancelled as (
    update bookings b set status = 'cancelled'
    where b.trip_id = p_trip_id and b.status = 'confirmed'
    returning 1
  )
  select count(*)::int into v_cancelled from cancelled;

  update trips set status = 'cancelled' where id = p_trip_id;

  -- Holds on a cancelled trip are meaningless; drop them so the seats are not
  -- reported as held to anyone still watching the map.
  delete from seat_locks where trip_id = p_trip_id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'tripId', p_trip_id,
    'cancelledBookings', v_cancelled,
    'trip', public.operator_trip_json(p_trip_id)));
end;
$$;

revoke all on function public.cancel_trip(uuid) from public, anon;
grant  execute on function public.cancel_trip(uuid) to authenticated;

-- ===========================================================================
-- 5. get_manifest — the boarding list for one own-company trip (§5).
--
-- paymentStatus: v1 has NO payments table. Every booking is cash-at-office, so
-- the only evidence the fare was collected is that the operator checked the
-- passenger in. It is therefore DERIVED, not stored:
--   checked_in_at is not null → 'paid', else 'unpaid'.
-- Flagged in the B5 report — if the contract wants real payment tracking it
-- needs a column, and that is a schema change, not an RPC change.
--
-- Only ACTIVE passengers appear: a cancelled booking's rows are not boarding.
-- ===========================================================================
create or replace function public.get_manifest(p_trip_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := auth.jwt() ->> 'user_role';
  v_company uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_rows    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if not exists (select 1 from trips where id = p_trip_id and company_id = v_company) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null));
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'seatNumber',  bp.seat_number,
        'fullName',    bp.full_name,
        'gender',      bp.gender,
        'phone',       bp.phone,
        'pnr',         b.pnr,
        'paymentStatus', case when bp.checked_in_at is not null then 'paid' else 'unpaid' end,
        'checkedInAt', case
                         when bp.checked_in_at is null then null
                         else to_char(bp.checked_in_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                       end
      )
      order by (case when bp.seat_number ~ '^[0-9]+$' then bp.seat_number::int end),
               bp.seat_number
    ),
    '[]'::jsonb)
  into v_rows
  from booking_passengers bp
  join bookings b on b.id = bp.booking_id
  where bp.trip_id = p_trip_id and bp.active;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'tripId', p_trip_id,
    'passengers', v_rows));
end;
$$;

revoke all on function public.get_manifest(uuid) from public, anon;
grant  execute on function public.get_manifest(uuid) to authenticated;

-- ===========================================================================
-- 6. check_in(qr_payload) and check_in_by_pnr(pnr).
--
-- qrPayload is `{bookingId}.{hex HMAC-SHA256(bookingId||tripId, vault secret)}`
-- (§4) — one QR per BOOKING, not per passenger. A booking can carry several
-- passengers, so a successful scan checks in every active passenger on it and
-- returns them all. (Task B5's sketch says "returns { booking, passenger }";
-- that reads as written for the one-seat case. `passengers` is the array form —
-- noted in the B5 report as a deliberate deviation.)
--
-- Every rejection that is not "already checked in" returns the SAME NOT_FOUND
-- code, with a machine-readable details.reason for the operator UI. A forged
-- signature and another company's genuine ticket must not be distinguishable
-- by code, or the scanner becomes an oracle for which bookings exist.
-- ===========================================================================
create or replace function public.check_in_booking(p_booking_id uuid, p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking record;
  v_already timestamptz;
  v_open    int;
begin
  select b.id, b.pnr, b.status, b.trip_id, t.company_id
  into v_booking
  from bookings b
  join trips t on t.id = b.trip_id
  where b.id = p_booking_id;

  if not found or v_booking.company_id is distinct from p_company_id then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Ticket not valid for this company',
      'details', jsonb_build_object('reason', 'not_found')));
  end if;

  if v_booking.status = 'cancelled' then
    -- A cancelled ticket scans fine and is REJECTED at the gate (§4).
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Booking is cancelled',
      'details', jsonb_build_object('reason', 'cancelled')));
  end if;

  select count(*) filter (where bp.checked_in_at is null),
         max(bp.checked_in_at)
  into v_open, v_already
  from booking_passengers bp
  where bp.booking_id = p_booking_id and bp.active;

  if v_open = 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Already checked in',
      'details', jsonb_build_object(
        'reason', 'already_checked_in',
        'checkedInAt', to_char(v_already at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))));
  end if;

  update booking_passengers bp set checked_in_at = now()
  where bp.booking_id = p_booking_id and bp.active and bp.checked_in_at is null;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'booking', jsonb_build_object(
      'id', v_booking.id, 'pnr', v_booking.pnr, 'status', v_booking.status),
    'passengers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'seatNumber', bp.seat_number,
          'fullName',   bp.full_name,
          'gender',     bp.gender,
          'checkedInAt', to_char(bp.checked_in_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        order by (case when bp.seat_number ~ '^[0-9]+$' then bp.seat_number::int end),
                 bp.seat_number), '[]'::jsonb)
      from booking_passengers bp
      where bp.booking_id = p_booking_id and bp.active)));
end;
$$;

revoke all on function public.check_in_booking(uuid, uuid) from public, anon, authenticated;

create or replace function public.check_in(p_qr_payload text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_role       text := auth.jwt() ->> 'user_role';
  v_company    uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_id_text    text;
  v_signature  text;
  v_booking_id uuid;
  v_trip_id    uuid;
  v_expected   text;

  v_reject constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'NOT_FOUND', 'message', 'Ticket not valid for this company',
    'details', jsonb_build_object('reason', 'not_found')));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  v_id_text   := split_part(coalesce(p_qr_payload, ''), '.', 1);
  v_signature := split_part(coalesce(p_qr_payload, ''), '.', 2);

  -- Malformed payload: same rejection as a genuine miss.
  if v_id_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or v_signature = '' then
    return v_reject;
  end if;

  v_booking_id := v_id_text::uuid;

  select trip_id into v_trip_id from bookings where id = v_booking_id;
  if not found then
    return v_reject;
  end if;

  -- Recompute over bookingId||tripId, exactly as booking_ticket() signs it.
  v_expected := encode(
    extensions.hmac(v_booking_id::text || v_trip_id::text, public.qr_hmac_secret(), 'sha256'),
    'hex');

  if v_signature <> v_expected then
    return v_reject;   -- tampered HMAC is indistinguishable from a missing booking
  end if;

  return public.check_in_booking(v_booking_id, v_company);
end;
$$;

revoke all on function public.check_in(text) from public, anon;
grant  execute on function public.check_in(text) to authenticated;

create or replace function public.check_in_by_pnr(p_pnr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_role       text := auth.jwt() ->> 'user_role';
  v_company    uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_booking_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  select id into v_booking_id
  from bookings
  where pnr = upper(btrim(coalesce(p_pnr, '')));

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Ticket not valid for this company',
      'details', jsonb_build_object('reason', 'not_found')));
  end if;

  -- Company ownership is re-checked inside; a PNR belonging to another
  -- operator returns the same NOT_FOUND as an unknown one.
  return public.check_in_booking(v_booking_id, v_company);
end;
$$;

revoke all on function public.check_in_by_pnr(text) from public, anon;
grant  execute on function public.check_in_by_pnr(text) to authenticated;

-- ===========================================================================
-- 7. operator_cancel_booking — no-show mitigation (§5).
-- Own-company only. NO time window: cancel_booking's CANCEL_WINDOW_CLOSED
-- protects the passenger from cancelling too late, which is not a constraint
-- the operator is under — they are freeing a seat nobody showed up for.
-- ===========================================================================
create or replace function public.operator_cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := auth.jwt() ->> 'user_role';
  v_company uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_booking record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  select b.id, b.pnr, b.status, b.trip_id, t.company_id
  into v_booking
  from bookings b
  join trips t on t.id = b.trip_id
  where b.id = p_booking_id;

  if not found or v_booking.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Booking not found', 'details', null));
  end if;

  -- Idempotent: cancelling an already-cancelled booking is not an error.
  if v_booking.status <> 'cancelled' then
    update bookings set status = 'cancelled' where id = p_booking_id;
    update booking_passengers set active = false where booking_id = p_booking_id;
  end if;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_booking.id, 'pnr', v_booking.pnr, 'status', 'cancelled',
    'tripId', v_booking.trip_id));
end;
$$;

revoke all on function public.operator_cancel_booking(uuid) from public, anon;
grant  execute on function public.operator_cancel_booking(uuid) to authenticated;

-- ===========================================================================
-- 8. Buses. Layout is IMMUTABLE once the bus has any published trip: the seat
-- map, every existing seat number and every held/booked seat are derived from
-- rows×cols, so shrinking a bus under a sold ticket would strand a passenger
-- in a seat that no longer exists.
-- ===========================================================================
create or replace function public.create_bus(
  p_plate_number text,
  p_bus_type     text,
  p_layout       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := auth.jwt() ->> 'user_role';
  v_company uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_bus_id  uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if coalesce(btrim(p_plate_number), '') = '' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Plate number is required',
      'details', jsonb_build_object('field', 'plateNumber')));
  end if;

  if coalesce(btrim(p_bus_type), '') = '' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Bus type is required',
      'details', jsonb_build_object('field', 'busType')));
  end if;

  -- The seat map reads exactly these three keys (§3); a layout missing one
  -- produces a bus whose get_seat_map cannot be rendered.
  if p_layout is null
     or jsonb_typeof(p_layout) <> 'object'
     or (p_layout->>'rows') is null or (p_layout->>'rows') !~ '^[0-9]+$' or (p_layout->>'rows')::int < 1
     or (p_layout->>'cols') is null or (p_layout->>'cols') !~ '^[0-9]+$' or (p_layout->>'cols')::int < 1
     or (p_layout->>'aisleAfterCol') is null or (p_layout->>'aisleAfterCol') !~ '^[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Layout needs positive integer rows, cols and aisleAfterCol',
      'details', jsonb_build_object('field', 'layout')));
  end if;

  begin
    insert into buses (company_id, plate_number, bus_type, layout)
    values (v_company, btrim(p_plate_number), btrim(p_bus_type), p_layout)
    returning id into v_bus_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'A bus with this plate number already exists',
      'details', jsonb_build_object('field', 'plateNumber')));
  end;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_bus_id, 'plateNumber', btrim(p_plate_number),
    'busType', btrim(p_bus_type), 'layout', p_layout));
end;
$$;

revoke all on function public.create_bus(text, text, jsonb) from public, anon;
grant  execute on function public.create_bus(text, text, jsonb) to authenticated;

create or replace function public.update_bus(
  p_bus_id       uuid,
  p_plate_number text  default null,
  p_bus_type     text  default null,
  p_layout       jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_role      text := auth.jwt() ->> 'user_role';
  v_company   uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_published int;
  v_bus       record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if not exists (select 1 from buses where id = p_bus_id and company_id = v_company) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Bus not found', 'details', null));
  end if;

  if p_layout is not null then
    select count(*)::int into v_published
    from trips where bus_id = p_bus_id and status = 'published';

    if v_published > 0 then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'VALIDATION_ERROR',
        'message', 'Layout cannot change once the bus has published trips',
        'details', jsonb_build_object(
          'field', 'layout',
          'reason', 'layout_immutable',
          'publishedTrips', v_published)));
    end if;
  end if;

  begin
    update buses b set
      plate_number = coalesce(btrim(p_plate_number), b.plate_number),
      bus_type     = coalesce(btrim(p_bus_type),     b.bus_type),
      layout       = coalesce(p_layout,              b.layout)
    where b.id = p_bus_id and b.company_id = v_company;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'A bus with this plate number already exists',
      'details', jsonb_build_object('field', 'plateNumber')));
  end;

  select id, plate_number, bus_type, layout into v_bus
  from buses where id = p_bus_id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_bus.id, 'plateNumber', v_bus.plate_number,
    'busType', v_bus.bus_type, 'layout', v_bus.layout));
end;
$$;

revoke all on function public.update_bus(uuid, text, text, jsonb) from public, anon;
grant  execute on function public.update_bus(uuid, text, text, jsonb) to authenticated;

-- ===========================================================================
-- 9. operator_summary(from_date, to_date) — one grouped query (§5).
--
-- SNAPSHOTTED RATES. commission uses bookings.commission_rate, the rate copied
-- onto each booking at creation (§4) — never companies.commission_rate. A rate
-- change must never move historical money (ADM-1 AC-2). This is the operator
-- half of that regression; commissions_by_month (B6) is the admin half.
--
-- CANCELLED BOOKINGS ARE EXCLUDED from bookings, revenue and commission, and
-- their passengers are already active=false so they leave occupancy too.
--
-- The date range is Damascus-local and inclusive of both ends, converted to a
-- UTC half-open window the same way search_trips does it.
-- ===========================================================================
create or replace function public.operator_summary(p_from_date date, p_to_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    text := auth.jwt() ->> 'user_role';
  v_company uuid := nullif(auth.jwt() ->> 'company_id', '')::uuid;
  v_data    jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'operator' or v_company is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Operator role required', 'details', null));
  end if;

  if p_from_date is null or p_to_date is null or p_to_date < p_from_date then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'to_date must be on or after from_date',
      'details', jsonb_build_object('field', 'toDate')));
  end if;

  with bounds as (
    select (p_from_date::timestamp        at time zone 'Asia/Damascus') as start_at,
           ((p_to_date + 1)::timestamp    at time zone 'Asia/Damascus') as end_at
  ),
  scoped_trips as (
    select t.id, (b.layout->>'rows')::int * (b.layout->>'cols')::int as capacity
    from trips t
    join buses b on b.id = t.bus_id
    cross join bounds
    where t.company_id = v_company
      and t.departure_at >= bounds.start_at
      and t.departure_at <  bounds.end_at
  ),
  money as (
    select
      count(*)::int                                            as bookings,
      coalesce(sum(bk.total_price), 0)::int                     as revenue,
      -- round once, at the end of the sum, so per-booking rounding cannot drift
      coalesce(round(sum(bk.total_price * bk.commission_rate)), 0)::int as commission
    from bookings bk
    join scoped_trips st on st.id = bk.trip_id
    where bk.status = 'confirmed'
  ),
  seats as (
    select
      coalesce(sum(st.capacity), 0)::int as capacity,
      (select count(*)::int
         from booking_passengers bp
         join scoped_trips st2 on st2.id = bp.trip_id
        where bp.active)                 as occupied
    from scoped_trips st
  )
  select jsonb_build_object(
    'from', to_char(p_from_date, 'YYYY-MM-DD'),
    'to',   to_char(p_to_date,   'YYYY-MM-DD'),
    'trips', (select count(*)::int from scoped_trips),
    'bookings',   m.bookings,
    'revenue',    m.revenue,
    'commission', m.commission,
    'net',        m.revenue - m.commission,
    'seatsCapacity', s.capacity,
    'seatsOccupied', s.occupied,
    -- null, not 0, when there is no capacity in range: "no trips" is not "0% full".
    'occupancyRate', case
                       when s.capacity = 0 then null
                       else round(s.occupied::numeric / s.capacity, 4)
                     end
  )
  into v_data
  from money m cross join seats s;

  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;

revoke all on function public.operator_summary(date, date) from public, anon;
grant  execute on function public.operator_summary(date, date) to authenticated;
