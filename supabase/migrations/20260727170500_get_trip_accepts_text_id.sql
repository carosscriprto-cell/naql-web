-- B7 / M7: get_trip takes TEXT and validates, instead of uuid.
--
-- THE BUG. get_trip(p_trip_id uuid) rejects a non-uuid argument at the type
-- boundary: Postgres raises 22P02 (invalid input syntax for type uuid) before
-- the function body runs. supabase-js surfaces that as a PostgrestError, which
-- lib/rpc.ts maps to ApiError("NETWORK_ERROR") — not the NOT_FOUND the body
-- would have returned. So /trips/not-a-uuid renders the generic "something went
-- wrong" card instead of "الرحلة غير موجودة", for what is simply a mistyped URL.
--
-- DECISION: option (a) — the RPC accepts text and validates.
-- Rejected option (b) (keep uuid, document malformed ids as out of contract and
-- have the frontend pre-validate), because:
--   · An id arrives from a URL segment, which is user input by definition. A
--     public read that is called with user input should be TOTAL over its input
--     type, not raise on it. "Not a trip id" and "no such trip id" are the same
--     answer to the caller: there is no trip.
--   · (b) pushes a uuid regex into every client that ever calls get_trip, and a
--     client that forgets it gets the wrong error card — the exact bug, moved
--     rather than fixed, and now duplicated per consumer.
--   · lookup_booking(p_pnr text, p_phone text) already sets this precedent: it
--     takes free text, validates internally, and answers NOT_FOUND. get_trip
--     taking uuid was the inconsistency.
--   · It is frontend-transparent: `supabase gen types` maps both uuid and text
--     to `string`, so Database["public"]["Functions"]["get_trip"]["Args"] is
--     unchanged and no frontend code or type has to move.
--
-- The uuid overload is DROPPED, not left alongside: two get_trip signatures
-- would make PostgREST's argument resolution ambiguous and would break the
-- T-SEC-1 count assertion, which counts routines and not names.
--
-- SCOPE. get_seat_map(p_trip_id uuid) and search_trips(p_travel_date date) have
-- the same shape of problem. They are NOT changed here — get_seat_map is only
-- ever called with an id the frontend already got from get_trip, and
-- search_trips' date comes from a date picker. Flagged in the B7 report rather
-- than fixed by drive-by.

drop function if exists public.get_trip(uuid);

create or replace function public.get_trip(p_trip_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_data   jsonb;
  v_id     uuid;
  v_policy text := 'الإلغاء مجاني حتى ساعتين قبل موعد الانطلاق. بعد ذلك لا يمكن استرداد قيمة التذكرة.';

  v_not_found constant jsonb := jsonb_build_object(
    'ok', false,
    'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null));
begin
  -- Malformed id → the SAME NOT_FOUND as a well-formed id that matches nothing.
  -- Checked with a regex rather than an exception handler so the happy path
  -- takes no subtransaction.
  if p_trip_id is null
     or p_trip_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return v_not_found;
  end if;

  v_id := p_trip_id::uuid;

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
  where t.id = v_id
    and t.status = 'published'
    and c.status = 'approved';

  if v_data is null then
    return v_not_found;
  end if;

  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;

revoke all on function public.get_trip(text) from public;
grant  execute on function public.get_trip(text) to anon, authenticated;
