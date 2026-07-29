-- B9 / M6: Admin RPCs (BACKEND_V1 §6).
--
-- CLAIMS. The Custom Access Token Hook (20260725202100_schema_rls_hook.sql)
-- injects `user_role`, NOT `role`: GoTrue owns `role` (it holds the Postgres
-- role PostgREST does SET ROLE on), so writing 'admin' there would break every
-- request. The contract sketch in §6 says "role: admin"; the implementation
-- reads auth.jwt()->>'user_role'. Admins carry NO company_id claim — the hook
-- strips the key when profiles.company_id is null — so unlike §5 there is
-- nothing company-scoped to check here, and an admin is global by construction.
--
-- ERROR MAPPING (§0 codes only — no new codes):
--   no session                     → UNAUTHORIZED (unreachable in practice, see
--                                    the GRANT note below — kept as defence)
--   signed in but not an admin     → FORBIDDEN. Note this is the OPPOSITE
--                                    choice from §5's cross-tenant NOT_FOUND:
--                                    there, NOT_FOUND hides whether another
--                                    company's row exists. Here the caller
--                                    already knows companies and cities exist —
--                                    they are public catalog (§2) — so there is
--                                    nothing to hide and FORBIDDEN is the honest
--                                    answer. T-ADM-SEC asserts exactly this.
--   unknown id                     → NOT_FOUND
--   bad input / blocked delete     → VALIDATION_ERROR with details.field and,
--                                    where there is a story to tell,
--                                    details.reason + the counts behind it.
-- Expected failures are RETURNED, never RAISEd.
--
-- GRANTS. Every function below is `authenticated`-only with anon revoked, the
-- same posture B7 established for §5 (20260727170000). A caller holding only
-- the anon key is refused by Postgres before the body runs — PostgREST returns
-- SQLSTATE 42501, not an envelope. That is the stronger guarantee and it keeps
-- the T-SEC-1 anon-callable set at exactly nine.

-- ===========================================================================
-- 1. admin_company_json — the shared admin-facing company shape.
-- camelCase, and deliberately WIDER than the public §2 company object: it
-- carries `status` and `commissionRate`, which no passenger-facing payload
-- includes. Internal helper; every caller has already proven admin.
-- ===========================================================================
create or replace function public.admin_company_json(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'logoUrl', c.logo_url,
    'rating', c.rating,
    'status', c.status,
    'commissionRate', c.commission_rate
  )
  from companies c
  where c.id = p_company_id;
$$;

revoke all on function public.admin_company_json(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. set_company_status(company_id, status) — pending | approved | suspended.
--
-- Suspension takes effect on the NEXT search_trips call: that function filters
-- `c.status = 'approved'` at query time (20260726125327_catalog_rpcs.sql), so
-- there is no cache, no materialised view and no trip rows to touch here. The
-- company's trips stay exactly as they are and reappear if it is re-approved —
-- suspending is not cancelling, and a suspended company's already-sold tickets
-- remain valid at the gate.
-- ===========================================================================
create or replace function public.set_company_status(
  p_company_id uuid,
  p_status     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := auth.jwt() ->> 'user_role';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Admin role required', 'details', null));
  end if;

  if p_status is null or p_status not in ('pending', 'approved', 'suspended') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Status must be pending, approved or suspended',
      'details', jsonb_build_object('field', 'status')));
  end if;

  if not exists (select 1 from companies where id = p_company_id) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Company not found', 'details', null));
  end if;

  update companies set status = p_status::public.company_status
  where id = p_company_id;

  return jsonb_build_object('ok', true, 'data', public.admin_company_json(p_company_id));
end;
$$;

revoke all on function public.set_company_status(uuid, text) from public, anon;
grant  execute on function public.set_company_status(uuid, text) to authenticated;

-- ===========================================================================
-- 3. set_commission_rate(company_id, rate) — 0.20–0.35 (§6, §8).
--
-- THE BOUND IS CHECKED TWICE, ON PURPOSE.
--
-- companies.commission_rate already carries `check (commission_rate between
-- 0.20 and 0.35)` from 20260725202100. Relying on it alone would let an
-- out-of-range rate reach the UPDATE and come back as SQLSTATE 23514 — a raw
-- exception, i.e. a transport failure with no `code`, which is exactly what
-- CLAUDE.md forbids and what T-ADM1-2 (0.19 / 0.36 → VALIDATION_ERROR) fails
-- on. So the range is validated in plpgsql first and the CHECK is caught as a
-- backstop; both paths return the same envelope.
--
-- THE VALIDATED VALUE IS THE STORED VALUE. The column is numeric(4,3), so the
-- UPDATE rounds to three decimals — and 0.3551 rounds to 0.355, which passes a
-- naive `p_rate <= 0.35` test and then trips the CHECK. Rounding FIRST and
-- validating the rounded value closes that gap, and is why the function stores
-- v_rate rather than p_rate.
--
-- Existing bookings are untouched by design: each snapshots commission_rate at
-- creation (§4), so a rate change moves future money only. operator_summary and
-- commissions_by_month both read the snapshot — ADM-1 AC-2, and the regression
-- both halves of tests/db/admin.test.ts exist to hold down.
-- ===========================================================================
create or replace function public.set_commission_rate(
  p_company_id uuid,
  p_rate       numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := auth.jwt() ->> 'user_role';
  v_rate numeric;

  v_out_of_range constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'VALIDATION_ERROR',
    'message', 'Commission rate must be between 0.20 and 0.35',
    'details', jsonb_build_object('field', 'commissionRate', 'min', 0.20, 'max', 0.35)));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Admin role required', 'details', null));
  end if;

  if p_rate is null then
    return v_out_of_range;
  end if;

  -- Round to the column's scale BEFORE comparing (see the header note).
  -- 'NaN'::numeric sorts above every real number in Postgres, so it fails the
  -- upper bound and lands here rather than reaching the UPDATE.
  v_rate := round(p_rate, 3);
  if v_rate < 0.20 or v_rate > 0.35 then
    return v_out_of_range;
  end if;

  if not exists (select 1 from companies where id = p_company_id) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Company not found', 'details', null));
  end if;

  begin
    update companies set commission_rate = v_rate where id = p_company_id;
  exception when check_violation then
    -- Unreachable while the guard above mirrors the CHECK. Kept so that a
    -- future tightening of the constraint degrades into an envelope instead of
    -- a 23514 the frontend has no code for.
    return v_out_of_range;
  end;

  return jsonb_build_object('ok', true, 'data', public.admin_company_json(p_company_id));
end;
$$;

revoke all on function public.set_commission_rate(uuid, numeric) from public, anon;
grant  execute on function public.set_commission_rate(uuid, numeric) to authenticated;

-- ===========================================================================
-- 4. commissions_by_month(month) — per-company totals for one month (§6).
--
-- SNAPSHOTTED RATES. commission sums bookings.commission_rate, the rate copied
-- onto each booking at creation — never companies.commission_rate. This is the
-- admin half of the ADM-1 AC-2 regression; operator_summary (20260727160000)
-- is the operator half, and admin.test.ts asserts a rate change moves NEITHER.
--
-- THE MONTH IS THE DEPARTURE MONTH, Damascus-local, not the booking-creation
-- month. Commission is earned on the journey, and operator_summary already
-- ranges on departure_at in Asia/Damascus — picking created_at here would make
-- the two reports disagree for every ticket sold in one month and travelled in
-- the next, which is most of them. The conversion to a half-open UTC window is
-- the same one search_trips and operator_summary use.
--
-- Cancelled bookings are excluded (they carry no revenue and no commission),
-- exactly as in operator_summary.
--
-- ONLY COMPANIES WITH AT LEAST ONE CONFIRMED BOOKING IN THE MONTH APPEAR. A
-- company that sold nothing owes nothing, and a zero row is noise in an
-- invoicing view. `companies: []` is the correct answer for an empty month.
--
-- ROUNDING. Each company's commission is rounded once, at the end of its own
-- sum, and `totals` is the sum of those ROUNDED per-company figures — so the
-- column adds up on screen. Rounding the grand sum separately could differ from
-- the visible rows by a pound, and an invoice that does not foot is a support
-- ticket.
-- ===========================================================================
create or replace function public.commissions_by_month(p_month text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text := auth.jwt() ->> 'user_role';
  v_start date;
  v_data  jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Admin role required', 'details', null));
  end if;

  -- 'YYYY-MM'. Validated with a regex rather than by casting, so a malformed
  -- month is an envelope and not SQLSTATE 22007 — the same reasoning that made
  -- get_trip take text (§2).
  if p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Month must be formatted YYYY-MM',
      'details', jsonb_build_object('field', 'month')));
  end if;

  v_start := (p_month || '-01')::date;

  with bounds as (
    select (v_start::timestamp                        at time zone 'Asia/Damascus') as start_at,
           ((v_start + interval '1 month')::timestamp at time zone 'Asia/Damascus') as end_at
  ),
  per_company as (
    select
      c.id                                   as company_id,
      c.name                                 as company_name,
      c.status                               as company_status,
      count(*)::int                          as bookings,
      coalesce(sum(bk.total_price), 0)::int   as revenue,
      coalesce(round(sum(bk.total_price * bk.commission_rate)), 0)::int as commission
    from bookings bk
    join trips t     on t.id = bk.trip_id
    join companies c on c.id = t.company_id
    cross join bounds
    where bk.status = 'confirmed'
      and t.departure_at >= bounds.start_at
      and t.departure_at <  bounds.end_at
    group by c.id, c.name, c.status
  ),
  rolled_up as (
    -- One pass over per_company: the rows AND the totals that must foot to them.
    select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'companyId',   pc.company_id,
          'companyName', pc.company_name,
          'status',      pc.company_status,
          'bookings',    pc.bookings,
          'revenue',     pc.revenue,
          'commission',  pc.commission,
          'net',         pc.revenue - pc.commission)
        order by pc.commission desc, pc.company_name), '[]'::jsonb) as items,
      coalesce(sum(pc.bookings),   0)::int as bookings,
      coalesce(sum(pc.revenue),    0)::int as revenue,
      coalesce(sum(pc.commission), 0)::int as commission
    from per_company pc
  )
  select jsonb_build_object(
    'month', p_month,
    'companies', r.items,
    'totals', jsonb_build_object(
      'bookings',   r.bookings,
      'revenue',    r.revenue,
      'commission', r.commission,
      'net',        r.revenue - r.commission)
  )
  into v_data
  from rolled_up r;

  return jsonb_build_object('ok', true, 'data', v_data);
end;
$$;

revoke all on function public.commissions_by_month(text) from public, anon;
grant  execute on function public.commissions_by_month(text) to authenticated;

-- ===========================================================================
-- 5. delete_city / delete_route — guarded deletes (§6, T-ADM2-1).
--
-- WHY AN RPC AND NOT THE BARE FK. routes.from_city_id / to_city_id and
-- trips.route_id are plain references, so Postgres already refuses these
-- deletes with SQLSTATE 23503 — but 23503 is a transport failure carrying no
-- §0 code and no explanation, so the admin UI could only ever render "something
-- went wrong". These functions turn the same refusal into a VALIDATION_ERROR
-- whose details say WHAT is in the way and HOW MUCH of it, which is what ADM-2's
-- "blocked with an explanation" actually requires.
--
-- TWO DISTINCT REASONS, deliberately:
--   'future_trips'      — the case the contract names. Refused because
--                         passengers hold tickets on journeys that have not
--                         happened yet.
--   'referenced_by_*'   — nothing future is at stake, but history is: past and
--                         draft trips still point here, and cascading them away
--                         would erase the bookings that reference them and the
--                         commission already reported on those bookings.
-- Both are VALIDATION_ERROR; `reason` is what the UI keys its wording on.
--
-- Nothing is ever cascaded. A delete that cannot be done cleanly is refused.
-- ===========================================================================
create or replace function public.delete_city(p_city_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := auth.jwt() ->> 'user_role';
  v_city   record;
  v_future int;
  v_routes int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Admin role required', 'details', null));
  end if;

  select c.id, c.name_ar, c.name_en, c.slug into v_city
  from cities c where c.id = p_city_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'City not found', 'details', null));
  end if;

  -- A city is an ENDPOINT of routes, so "its trips" are the trips of every
  -- route that starts or ends here — in either direction.
  select count(*)::int into v_future
  from trips t
  join routes r on r.id = t.route_id
  where (r.from_city_id = p_city_id or r.to_city_id = p_city_id)
    and t.status = 'published'
    and t.departure_at > now();

  if v_future > 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'City has future published trips and cannot be deleted',
      'details', jsonb_build_object(
        'field', 'cityId', 'reason', 'future_trips', 'trips', v_future)));
  end if;

  select count(*)::int into v_routes
  from routes r
  where r.from_city_id = p_city_id or r.to_city_id = p_city_id;

  if v_routes > 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'City is still used by routes and cannot be deleted',
      'details', jsonb_build_object(
        'field', 'cityId', 'reason', 'referenced_by_routes', 'routes', v_routes)));
  end if;

  begin
    delete from cities where id = p_city_id;
  exception when foreign_key_violation then
    -- Backstop for a reference this function does not yet know about (a future
    -- table pointing at cities). Refuse in an envelope rather than raise 23503.
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'City is still referenced and cannot be deleted',
      'details', jsonb_build_object('field', 'cityId', 'reason', 'in_use')));
  end;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_city.id, 'nameAr', v_city.name_ar, 'nameEn', v_city.name_en,
    'slug', v_city.slug, 'deleted', true));
end;
$$;

revoke all on function public.delete_city(uuid) from public, anon;
grant  execute on function public.delete_city(uuid) to authenticated;

create or replace function public.delete_route(p_route_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := auth.jwt() ->> 'user_role';
  v_route  record;
  v_future int;
  v_trips  int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  if v_role is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'FORBIDDEN', 'message', 'Admin role required', 'details', null));
  end if;

  select r.id, r.from_city_id, r.to_city_id into v_route
  from routes r where r.id = p_route_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Route not found', 'details', null));
  end if;

  select count(*)::int into v_future
  from trips t
  where t.route_id = p_route_id
    and t.status = 'published'
    and t.departure_at > now();

  if v_future > 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'Route has future published trips and cannot be deleted',
      'details', jsonb_build_object(
        'field', 'routeId', 'reason', 'future_trips', 'trips', v_future)));
  end if;

  select count(*)::int into v_trips from trips t where t.route_id = p_route_id;

  if v_trips > 0 then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'Route still has trips and cannot be deleted',
      'details', jsonb_build_object(
        'field', 'routeId', 'reason', 'referenced_by_trips', 'trips', v_trips)));
  end if;

  begin
    delete from routes where id = p_route_id;
  exception when foreign_key_violation then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR',
      'message', 'Route is still referenced and cannot be deleted',
      'details', jsonb_build_object('field', 'routeId', 'reason', 'in_use')));
  end;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_route.id,
    'fromCityId', v_route.from_city_id,
    'toCityId', v_route.to_city_id,
    'deleted', true));
end;
$$;

revoke all on function public.delete_route(uuid) from public, anon;
grant  execute on function public.delete_route(uuid) to authenticated;
