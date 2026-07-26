-- B2 / M2: Catalog RPCs — search_trips + get_trip (BACKEND_V1 §2).
--
-- Both are SECURITY DEFINER: availableSeats is derived from booking_passengers
-- and seat_lock_seats, which are RLS-denied to anon/authenticated. The function
-- owner bypasses RLS so the counts are correct for public callers.
--
-- ASYMMETRY (per §2, kept deliberately):
--   search_trips → a BARE JSON ARRAY (it's a read).
--   get_trip     → the §0 ENVELOPE { ok, data } | { ok, error }.

-- Shared cancellation-policy text (mirrors src/mocks/data.ts; the 2h figure is
-- the app_config cancel_window_hours value surfaced as display prose).
-- ===========================================================================

-- ===========================================================================
-- search_trips — bare array of §2 items, camelCase via jsonb_build_object.
-- ===========================================================================
create or replace function public.search_trips(
  p_from_slug   text,
  p_to_slug     text,
  p_travel_date date,
  p_passengers  int
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    -- p_travel_date is Syria-local; convert to a [start, next-day) UTC window.
    select
      (p_travel_date::timestamp        at time zone 'Asia/Damascus') as start_at,
      ((p_travel_date + 1)::timestamp  at time zone 'Asia/Damascus') as end_at
  )
  select coalesce(jsonb_agg(x.item order by x.departure_at), '[]'::jsonb)
  from (
    select
      t.departure_at,
      jsonb_build_object(
        'id', t.id,
        'company', jsonb_build_object(
          'id', c.id, 'name', c.name, 'logoUrl', c.logo_url, 'rating', c.rating
        ),
        'fromCity', jsonb_build_object('id', fc.id, 'nameAr', fc.name_ar),
        'toCity',   jsonb_build_object('id', tc.id, 'nameAr', tc.name_ar),
        'departureAt', to_char(t.departure_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'arrivalAt',   to_char(t.arrival_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'price', t.price,
        'currency', 'SYP',
        'availableSeats', avail.n,
        'busType', b.bus_type
      ) as item
    from trips t
    join companies c on c.id = t.company_id
    join routes    r on r.id = t.route_id
    join cities   fc on fc.id = r.from_city_id
    join cities   tc on tc.id = r.to_city_id
    join buses     b on b.id = t.bus_id
    cross join bounds
    cross join lateral (
      select (
        (b.layout->>'rows')::int * (b.layout->>'cols')::int
        - (select count(*)::int from booking_passengers bp
             where bp.trip_id = t.id and bp.active)
        - (select count(*)::int from seat_lock_seats sls
             join seat_locks sl on sl.id = sls.lock_id
             where sls.trip_id = t.id and sl.expires_at > now())
      ) as n
    ) avail
    where fc.slug = p_from_slug
      and tc.slug = p_to_slug
      and t.status = 'published'
      and c.status = 'approved'          -- suspension takes effect on the next call
      and t.departure_at > now()
      and t.departure_at >= bounds.start_at
      and t.departure_at <  bounds.end_at
      and avail.n >= coalesce(p_passengers, 1)
  ) x;
$$;

-- ===========================================================================
-- get_trip — §2 item + cancellationPolicy, wrapped in the §0 envelope.
-- Missing / draft / suspended-company → NOT_FOUND. DEPARTED trips ARE returned
-- (no departure_at filter here) so the frontend can render the disabled CTA.
-- ===========================================================================
create or replace function public.get_trip(p_trip_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data   jsonb;
  v_policy text := 'الإلغاء مجاني حتى ساعتين قبل موعد الانطلاق. بعد ذلك لا يمكن استرداد قيمة التذكرة.';
begin
  select jsonb_build_object(
    'id', t.id,
    'company', jsonb_build_object(
      'id', c.id, 'name', c.name, 'logoUrl', c.logo_url, 'rating', c.rating
    ),
    'fromCity', jsonb_build_object('id', fc.id, 'nameAr', fc.name_ar),
    'toCity',   jsonb_build_object('id', tc.id, 'nameAr', tc.name_ar),
    'departureAt', to_char(t.departure_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'arrivalAt',   to_char(t.arrival_at   at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'price', t.price,
    'currency', 'SYP',
    'availableSeats', (
      (b.layout->>'rows')::int * (b.layout->>'cols')::int
      - (select count(*)::int from booking_passengers bp
           where bp.trip_id = t.id and bp.active)
      - (select count(*)::int from seat_lock_seats sls
           join seat_locks sl on sl.id = sls.lock_id
           where sls.trip_id = t.id and sl.expires_at > now())
    ),
    'busType', b.bus_type,
    'cancellationPolicy', v_policy
  )
  into v_data
  from trips t
  join companies c on c.id = t.company_id
  join routes    r on r.id = t.route_id
  join cities   fc on fc.id = r.from_city_id
  join cities   tc on tc.id = r.to_city_id
  join buses     b on b.id = t.bus_id
  where t.id = p_trip_id
    and t.status = 'published'
    and c.status = 'approved';

  if v_data is null then
    return jsonb_build_object(
      'ok', false,
      'error', jsonb_build_object(
        'code', 'NOT_FOUND',
        'message', 'Trip not found',
        'details', null
      )
    );
  end if;

  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;

-- ===========================================================================
-- Grants — both are public catalog reads (anon + authenticated only).
-- ===========================================================================
revoke all on function public.search_trips(text, text, date, int) from public;
grant  execute on function public.search_trips(text, text, date, int) to anon, authenticated;

revoke all on function public.get_trip(uuid) from public;
grant  execute on function public.get_trip(uuid) to anon, authenticated;
