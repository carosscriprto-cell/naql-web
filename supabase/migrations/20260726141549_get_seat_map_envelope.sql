-- Parity decision: get_seat_map is now ENVELOPED (BACKEND_V1 §0 envelope rule + §3).
-- It has a real domain failure mode (NOT_FOUND for missing/draft/suspended-company
-- trips), so it returns { ok, data } | { ok, error } instead of a bare object / null.
-- Departed-but-published trips still return ok. Everything else is identical to the
-- B3 definition — only the final return is wrapped.
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
      jsonb_build_object('ok', true, 'data', jsonb_build_object(
        'layout', (select layout from dims),
        'seats',  (select coalesce(jsonb_agg(seat order by n), '[]'::jsonb) from seats)
      ))
    else
      jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'NOT_FOUND', 'message', 'Trip not found', 'details', null))
  end;
$$;

-- Grants unchanged (create-or-replace preserves them), re-asserted for clarity.
revoke all on function public.get_seat_map(uuid) from public;
grant  execute on function public.get_seat_map(uuid) to anon, authenticated;
