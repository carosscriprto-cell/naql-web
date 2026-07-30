-- B10 / M6: bookings.payment_status — a real column, not an inference.
--
-- THE BUG THIS FIXES. get_manifest (20260727160000_operator_rpcs.sql, §5) had no
-- payment column to read, so it DERIVED the field:
--     'paymentStatus', case when bp.checked_in_at is not null then 'paid' else 'unpaid' end
-- Payment is cash-at-office in v1 (BACKEND_V1 §4) and boarding is a separate
-- event, so that identity is false in both directions:
--   · a passenger who paid at the office yesterday and has not boarded reads
--     'unpaid' — the operator is looking at a paid ticket and is asked to
--     collect the fare a second time;
--   · a passenger waved through at the gate reads 'paid' whether or not a pound
--     was ever collected, so the one report that could catch a missing fare
--     (get_manifest) is exactly the report that cannot.
-- The two facts are now stored separately. checked_in_at keeps meaning boarded;
-- payment_status means paid. check_in is NOT touched by this migration.
--
-- WHY ON bookings AND NOT ON booking_passengers. A fare is collected once per
-- booking — one PNR, one cash transaction at the counter — not per seat, and §8
-- places the column on `bookings`. The manifest still emits `paymentStatus` on
-- every PASSENGER row (the wire shape is unchanged, §5); the rows of one booking
-- simply all carry their parent booking's value. A per-seat split would be a
-- different product decision and a different column.
--
-- WHY A CHECK AND NOT AN ENUM. The neighbouring status columns are enums
-- (booking_status, company_status, trip_status), so this is the deliberate
-- exception: `create type` has no `if not exists`, and this file is applied by
-- hand through the SQL editor (docs/MANUAL_MIGRATION_RUNBOOK.md), where a file
-- that cannot survive being pasted twice is a hazard. A named CHECK is
-- drop-then-add idempotent. The trade-off is that the allowed set is not
-- reusable across columns — nothing else needs it.
--
-- BACKFILL IS 'unpaid' FOR EVERY EXISTING ROW, deliberately. There are no
-- payment records in v1 to reconstruct from, and the old derivation is not
-- evidence — it only ever said "checked in". Inventing 'paid' from it would
-- write the very error this migration removes into the table as fact. Unpaid is
-- the answer that is provably true: nobody has recorded a payment yet. On DEV
-- this means checked-in bookings stop reading 'paid' the moment this lands; see
-- the runbook step, that flip is expected.

-- ===========================================================================
-- 1. The column.
-- ===========================================================================
alter table public.bookings
  add column if not exists payment_status text not null default 'unpaid';

-- Drop-then-add so a second paste of this file is a no-op rather than a 42710.
alter table public.bookings
  drop constraint if exists bookings_payment_status_check;

alter table public.bookings
  add constraint bookings_payment_status_check
  check (payment_status in ('unpaid', 'paid'));

comment on column public.bookings.payment_status is
  'unpaid | paid. Cash collected at the office (BACKEND_V1 §4). INDEPENDENT of '
  'booking_passengers.checked_in_at, which records boarding. Set only through '
  'set_booking_payment_status().';

-- No index: the only reader is get_manifest, which is already scoped to one
-- trip's passengers and joins bookings by primary key.

-- ===========================================================================
-- 2. set_booking_payment_status(booking_id, status) — the operator's till.
--
-- REVERSIBLE, not a one-way "mark paid". The contract sketch asks for marking a
-- booking paid; this takes the target status instead, for one practical reason:
-- the caller is an operator tapping a row on a phone at a counter, and a mis-tap
-- on a one-way switch would be uncorrectable without a DBA. It also gives a
-- refund somewhere to be recorded. The naming matches set_company_status
-- (20260729161545). Marking paid is p_payment_status => 'paid'.
--
-- OWN-COMPANY ONLY, and a booking outside the caller's company is NOT_FOUND —
-- never FORBIDDEN — exactly as operator_cancel_booking does it: FORBIDDEN would
-- confirm the booking exists, turning this into an oracle for other companies'
-- PNRs.
--
-- IDEMPOTENT: marking an already-paid booking paid is ok, not an error, like
-- operator_cancel_booking's second cancel.
--
-- A CANCELLED BOOKING CANNOT BE MARKED PAID (VALIDATION_ERROR, reason
-- 'cancelled') — there is no fare to collect on a dead ticket, and letting one
-- through would put revenue on a booking that operator_summary and
-- commissions_by_month both exclude. The reverse IS allowed: setting a cancelled
-- booking back to 'unpaid' is how a refund gets recorded.
-- ===========================================================================
create or replace function public.set_booking_payment_status(
  p_booking_id     uuid,
  p_payment_status text
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

  -- Validated before the lookup: the answer does not depend on the booking, so
  -- checking it first leaks nothing and keeps the guard order identical to
  -- set_company_status.
  if p_payment_status is null or p_payment_status not in ('unpaid', 'paid') then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Payment status must be unpaid or paid',
      'details', jsonb_build_object('field', 'paymentStatus')));
  end if;

  select b.id, b.pnr, b.status, b.trip_id, b.payment_status, t.company_id
  into v_booking
  from bookings b
  join trips t on t.id = b.trip_id
  where b.id = p_booking_id;

  if not found or v_booking.company_id is distinct from v_company then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'NOT_FOUND', 'message', 'Booking not found', 'details', null));
  end if;

  if v_booking.status = 'cancelled' and p_payment_status = 'paid' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Booking is cancelled',
      'details', jsonb_build_object('field', 'paymentStatus', 'reason', 'cancelled')));
  end if;

  update bookings set payment_status = p_payment_status where id = p_booking_id;

  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id',            v_booking.id,
    'pnr',           v_booking.pnr,
    'status',        v_booking.status,
    'tripId',        v_booking.trip_id,
    'paymentStatus', p_payment_status));
end;
$$;

revoke all on function public.set_booking_payment_status(uuid, text) from public, anon;
grant  execute on function public.set_booking_payment_status(uuid, text) to authenticated;

-- ===========================================================================
-- 3. get_manifest — read the column instead of inferring it.
--
-- Replaced verbatim from 20260727160000_operator_rpcs.sql except for the
-- paymentStatus expression and this header. The wire shape is BYTE IDENTICAL:
-- same keys, same key order, same row ordering. Only the VALUE of paymentStatus
-- changes, and only where the two facts actually disagreed.
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
        'paymentStatus', b.payment_status,
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
