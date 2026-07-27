-- B4 / M4: Booking (BACKEND_V1 §4). Second-highest-risk code in the product
-- after B3 locking.
--
-- Executable reference: the POST /api/bookings handler in src/mocks/handlers.ts —
-- the frontend was built and QA'd against it. §4 is authoritative where MSW is
-- silent (it never simulated trip validity, passenger coverage, phone/name
-- validation, real limits, the HMAC, or the lookup rate limit).
--
-- Everything here is SECURITY DEFINER: bookings / booking_passengers / seat_locks /
-- app_config / lookup_attempts are RLS-denied (or policy-scoped) to clients, so the
-- explicit ownership + trip-validity checks INSIDE each function are the security
-- boundary, not RLS. Never remove them.

-- ===========================================================================
-- 1. Schema additions
-- ===========================================================================

-- Idempotency needs more than the key: same key + DIFFERENT payload must be a
-- conflict, so the payload hash is stored next to the key (§4).
alter table public.bookings
  add column if not exists payload_hash text;

comment on column public.bookings.payload_hash is
  'sha256 of the canonical create_booking argument payload. Same idempotency_key + different hash → IDEMPOTENCY_CONFLICT.';

-- lookup_booking is unauthenticated, so it is the enumeration surface of the
-- whole product. Attempts are keyed by PNR (the thing being guessed) and counted
-- in a sliding window. Deny-by-default RLS + no grants: only the RPC touches it.
create table if not exists public.lookup_attempts (
  id           uuid primary key default gen_random_uuid(),
  pnr          text not null,
  attempted_at timestamptz not null default now()
);

create index if not exists lookup_attempts_pnr_time_idx
  on public.lookup_attempts (pnr, attempted_at desc);

alter table public.lookup_attempts enable row level security;

comment on table public.lookup_attempts is
  'Rate-limit ledger for lookup_booking. One row per attempt — hits AND misses, because a counter that only counts misses leaks which PNRs exist.';

-- Config values, never literals (CLAUDE.md). The other four keys ship in
-- migration 20260725141239.
insert into public.app_config (key, value) values
  ('lookup_rate_limit_max',             '10'::jsonb),
  ('lookup_rate_limit_window_minutes',  '60'::jsonb)
on conflict (key) do nothing;

-- ===========================================================================
-- 2. Vault — the QR HMAC secret
--
-- The secret is NEVER inlined in a migration or a function body. It lives in
-- Supabase Vault and is read through vault.decrypted_secrets at call time.
--   · DEV + CI  : supabase/seed.sql creates a fixed, well-known secret if absent.
--                 seed.sql never runs on PROD (`migration up` only), so the dev
--                 value cannot leak into production.
--   · PROD      : created once, manually, before launch — README pre-launch checklist.
-- A missing secret is an infrastructure fault, not a domain error: it RAISES
-- (loud) instead of returning an envelope (silent).
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault') then
    create extension supabase_vault;
  end if;
end $$;

create or replace function public.qr_hmac_secret()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'qr_hmac_secret';

  if v_secret is null then
    raise exception
      'Vault secret "qr_hmac_secret" is missing. DEV/CI get it from supabase/seed.sql; PROD needs the manual pre-launch step in README.'
      using errcode = 'internal_error';
  end if;

  return v_secret;
end;
$$;

revoke all on function public.qr_hmac_secret() from public, anon, authenticated;

-- ===========================================================================
-- 3. PNR generator — 6 chars from an alphabet with no 0 O 1 I (§4).
-- Uniqueness is the UNIQUE index on bookings.pnr; create_booking retries on
-- collision. This function only produces candidates.
-- ===========================================================================
create or replace function public.generate_pnr()
returns text
language sql
volatile
set search_path = public
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                  1 + floor(random() * 32)::int, 1),
           '')
  from generate_series(1, 6);
$$;

revoke all on function public.generate_pnr() from public, anon, authenticated;

-- ===========================================================================
-- 4. booking_ticket — the §4 response body, built from live rows.
--
--   { id, pnr, status, qrPayload, trip, passengers, totalPrice }
--
-- `trip` is the FULL §2 search-item shape (nested company / fromCity / toCity,
-- availableSeats, busType) because the frontend's bookingSchema reuses
-- tripSearchItemSchema and requires every field.
--
-- availableSeats here is a snapshot with no meaning on a ticket (§4) — it is
-- recomputed live on every get_booking / lookup_booking call and will drift from
-- the value stored in response_snapshot. Documented and accepted.
--
-- qrPayload is deterministic: {bookingId}.{HMAC-SHA256(bookingId||tripId, secret)},
-- so rebuilding a ticket always reproduces the same QR the passenger already has.
-- ===========================================================================
create or replace function public.booking_ticket(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'pnr', b.pnr,
    'status', b.status,
    'qrPayload', b.id::text || '.' ||
                 encode(extensions.hmac(b.id::text || b.trip_id::text,
                                        public.qr_hmac_secret(), 'sha256'), 'hex'),
    'trip', jsonb_build_object(
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
        (bs.layout->>'rows')::int * (bs.layout->>'cols')::int
        - (select count(*)::int from booking_passengers bp2
             where bp2.trip_id = t.id and bp2.active)
        - (select count(*)::int from seat_lock_seats sls
             join seat_locks sl on sl.id = sls.lock_id
             where sls.trip_id = t.id and sl.expires_at > now())
      ),
      'busType', bs.bus_type
    ),
    'passengers', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'seatNumber', bp.seat_number,
            'fullName',   bp.full_name,
            'phone',      bp.phone,
            'gender',     bp.gender
          )
          -- seat order, numerically: the frontend renders the list as-is and the
          -- checkout form is built in seat order, so this matches what was sent.
          order by (case when bp.seat_number ~ '^[0-9]+$' then bp.seat_number::int end),
                   bp.seat_number
        ),
        '[]'::jsonb
      )
      from booking_passengers bp
      where bp.booking_id = b.id
    ),
    'totalPrice', b.total_price
  )
  from bookings   b
  join trips      t  on t.id  = b.trip_id
  join companies  c  on c.id  = t.company_id
  join routes     r  on r.id  = t.route_id
  join cities     fc on fc.id = r.from_city_id
  join cities     tc on tc.id = r.to_city_id
  join buses      bs on bs.id = t.bus_id
  where b.id = p_booking_id;
$$;

revoke all on function public.booking_ticket(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 5. create_booking (§4) — ONE transaction.
--
-- Validation order is part of the contract: when two things are wrong at once it
-- decides which error the caller sees, and the frontend UX is built on that.
--   a. idempotency (replay / conflict)
--   b. lock (exists + owned + unexpired)     → LOCK_EXPIRED
--   c. trip still bookable                    → TRIP_DEPARTED
--   d. passengers (coverage, gender, phone, name) → VALIDATION_ERROR
--   e. booking limits                         → BOOKING_LIMIT_REACHED
--   f. insert booking + passengers            → SEAT_ALREADY_BOOKED on the partial index
--   g. qrPayload
--   h. consume the lock, store the snapshot, return
-- ===========================================================================
create or replace function public.create_booking(
  p_lock_id         uuid,
  p_idempotency_key uuid,
  p_payment_method  text,
  p_passengers      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_hash        text;
  v_prior       record;
  v_lock        record;
  v_trip        record;
  v_lock_seats  text[];
  v_pax_seats   text[];
  v_seat        text;
  v_max         int;
  v_count       int;
  v_seat_count  int;
  v_booking_id  uuid;
  v_pnr         text;
  v_ticket      jsonb;
  v_snapshot    jsonb;
  v_conflict    boolean;
  v_replay      boolean := false;
  v_constraint  text;
  c_pnr_tries   constant int := 10;

  v_lock_expired constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'LOCK_EXPIRED', 'message', 'Seat hold has expired', 'details', null));
begin
  -- Precondition, not one of the (a)..(e) domain validations: idempotency_key is
  -- REQUIRED (§4). Without it there is nothing to look up, nothing to serialise
  -- on, and the NOT NULL column would fail the insert with a raw SQL error
  -- instead of an envelope.
  if p_idempotency_key is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'idempotencyKey is required',
      'details', jsonb_build_object('field', 'idempotencyKey')));
  end if;

  -- Canonical payload hash. jsonb sorts object keys and de-duplicates them, so
  -- ::text is stable for the same logical payload regardless of the order the
  -- client serialised its object fields. Array order IS significant (mirrors
  -- bookingHash() in handlers.ts, which JSON.stringify's the passengers array).
  v_hash := encode(
    sha256(convert_to(jsonb_build_object(
      'lockId',        p_lock_id,
      'paymentMethod', p_payment_method,
      'passengers',    p_passengers
    )::text, 'UTF8')),
    'hex');

  -- Serialise callers sharing an idempotency key BEFORE the lookup. Without this,
  -- two parallel identical calls both miss in (a), both proceed, and the loser
  -- reports LOCK_EXPIRED (the winner consumed the lock) instead of replaying the
  -- winner's response. With it, the loser blocks here, then finds the committed
  -- row in (a) and replays it. This is the merge gate.
  perform pg_advisory_xact_lock(hashtext('create_booking:' || p_idempotency_key::text)::bigint);

  -- ---------------------------------------------------------------------
  -- a. Idempotency FIRST — before any lock/trip/passenger check, so a retry of
  --    a succeeded call replays even after its lock is long gone.
  -- ---------------------------------------------------------------------
  select id, payload_hash, response_snapshot into v_prior
  from bookings
  where idempotency_key = p_idempotency_key;

  if found then
    if v_prior.payload_hash is not distinct from v_hash then
      -- Verbatim replay — never a second row. (coalesce: rows seeded before
      -- response_snapshot existed rebuild the ticket instead of returning null.)
      return coalesce(
        v_prior.response_snapshot,
        jsonb_build_object('ok', true, 'data', public.booking_ticket(v_prior.id)));
    end if;
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'IDEMPOTENCY_CONFLICT', 'message', 'Same idempotency key with a different payload',
      'details', null));
  end if;

  -- ---------------------------------------------------------------------
  -- b. Lock: exists AND owned by the caller AND unexpired.
  --
  --    A MISSING lock, an EXPIRED lock and ANOTHER USER'S lock all return the
  --    same LOCK_EXPIRED — never FORBIDDEN. FORBIDDEN would disclose that the
  --    lock exists and belongs to someone else, which is exactly what a caller
  --    probing lock ids wants to learn.
  --    Contrast release_lock (B3), which DOES return FORBIDDEN for a non-owner:
  --    there the caller names a lockId they claim to own, so telling them it is
  --    someone else's is the point of the call, not a leak.
  -- ---------------------------------------------------------------------
  select sl.id, sl.trip_id, sl.owner_id, sl.expires_at into v_lock
  from seat_locks sl
  where sl.id = p_lock_id;

  if not found
     or v_lock.owner_id is distinct from v_uid
     or v_lock.expires_at <= now() then
    return v_lock_expired;
  end if;

  -- ---------------------------------------------------------------------
  -- c. Trip still bookable: published, company approved, not departed.
  --    A draft / suspended-company trip also lands here as TRIP_DEPARTED (§4):
  --    the lock proves the trip was bookable a moment ago, so "no longer
  --    bookable" is the honest answer and it discloses nothing new.
  -- ---------------------------------------------------------------------
  select t.id, t.price, c.commission_rate into v_trip
  from trips t
  join companies c on c.id = t.company_id
  where t.id = v_lock.trip_id
    and t.status = 'published'
    and c.status = 'approved'
    and t.departure_at > now();

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'TRIP_DEPARTED', 'message', 'Trip is no longer bookable', 'details', null));
  end if;

  -- ---------------------------------------------------------------------
  -- d. Passenger validation. All failures → VALIDATION_ERROR. The field
  --    convention is "passenger.{seatNumber}.{field}"; whole-set coverage is the
  --    exception and uses "passengers" (§4).
  -- ---------------------------------------------------------------------
  if p_passengers is null or jsonb_typeof(p_passengers) <> 'array' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Passengers must cover exactly the held seats',
      'details', jsonb_build_object('field', 'passengers')));
  end if;

  select array_agg(s.seat_number order by s.seat_number) into v_lock_seats
  from seat_lock_seats s
  where s.lock_id = p_lock_id;

  select array_agg(e.seat_number order by e.seat_number) into v_pax_seats
  from (
    select value->>'seatNumber' as seat_number
    from jsonb_array_elements(p_passengers)
  ) e;

  -- Sorted multiset equality: catches a missing seat, an extra seat AND a
  -- duplicated seat (lock seats are unique, so any duplicate makes the arrays differ).
  if v_pax_seats is distinct from v_lock_seats then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Passengers must cover exactly the held seats',
      'details', jsonb_build_object('field', 'passengers')));
  end if;

  -- gender must equal the gender declared on that seat's lock — the seat map
  -- never lies. Request order decides which seat is reported.
  select e.seat_number into v_seat
  from (
    select value->>'seatNumber' as seat_number,
           value->>'gender'     as gender,
           ordinality           as ord
    from jsonb_array_elements(p_passengers) with ordinality
  ) e
  join seat_lock_seats s on s.lock_id = p_lock_id and s.seat_number = e.seat_number
  where e.gender is null or e.gender <> s.gender::text
  order by e.ord
  limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Passenger gender does not match the held seat',
      'details', jsonb_build_object('field', 'passenger.' || v_seat || '.gender')));
  end if;

  -- phone: server-side, same regex as the client form (§4).
  select e.seat_number into v_seat
  from (
    select value->>'seatNumber' as seat_number,
           value->>'phone'      as phone,
           ordinality           as ord
    from jsonb_array_elements(p_passengers) with ordinality
  ) e
  where e.phone is null or e.phone !~ '^\+9639\d{8}$'
  order by e.ord
  limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Invalid phone number',
      'details', jsonb_build_object('field', 'passenger.' || v_seat || '.phone')));
  end if;

  -- fullName: non-empty after trim, at least 3 characters.
  select e.seat_number into v_seat
  from (
    select value->>'seatNumber' as seat_number,
           value->>'fullName'   as full_name,
           ordinality           as ord
    from jsonb_array_elements(p_passengers) with ordinality
  ) e
  where e.full_name is null or char_length(btrim(e.full_name)) < 3
  order by e.ord
  limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'VALIDATION_ERROR', 'message', 'Passenger name is too short',
      'details', jsonb_build_object('field', 'passenger.' || v_seat || '.fullName')));
  end if;

  -- ---------------------------------------------------------------------
  -- e. Booking limits (anti-abuse, §1) — both ceilings come from app_config,
  --    never from literals. Nothing is created when either trips.
  -- ---------------------------------------------------------------------
  select ((value)::text)::int into v_max
  from app_config where key = 'max_active_bookings_per_user';

  select count(*) into v_count
  from bookings b
  join trips t on t.id = b.trip_id
  where b.user_id = v_uid
    and b.status = 'confirmed'
    and t.departure_at > now();

  if v_count >= v_max then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'BOOKING_LIMIT_REACHED', 'message', 'Too many active bookings', 'details', null));
  end if;

  select ((value)::text)::int into v_max
  from app_config where key = 'max_active_bookings_per_phone_per_trip';

  -- Per phone, on THIS trip: rows already booked + rows this request would add.
  select e.seat_number into v_seat
  from (
    select value->>'seatNumber' as seat_number,
           value->>'phone'      as phone,
           ordinality           as ord
    from jsonb_array_elements(p_passengers) with ordinality
  ) e
  where (
    (select count(*) from booking_passengers bp
      where bp.trip_id = v_lock.trip_id and bp.active and bp.phone = e.phone)
    + (select count(*) from jsonb_array_elements(p_passengers) p
        where p.value->>'phone' = e.phone)
  ) > v_max
  order by e.ord
  limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'BOOKING_LIMIT_REACHED', 'message', 'Too many bookings for this phone on this trip',
      'details', null));
  end if;

  -- ---------------------------------------------------------------------
  -- f. Insert. Both inserts live in ONE sub-block so that a seat collision
  --    rolls the booking row back with the passengers — never a booking with
  --    zero passengers, never a partially seated booking.
  --
  --    The partial unique index booking_passengers(trip_id, seat_number) WHERE
  --    active is the FINAL double-booking guarantee: whatever raced past the
  --    lock, the index cannot be beaten → SEAT_ALREADY_BOOKED.
  -- ---------------------------------------------------------------------
  v_seat_count := coalesce(array_length(v_lock_seats, 1), 0);

  begin
    -- PNR: retry on collision against the UNIQUE index (§4).
    for i in 1..c_pnr_tries loop
      v_pnr := public.generate_pnr();
      v_conflict := false;
      begin
        insert into bookings (
          trip_id, user_id, pnr, status, payment_method,
          total_price, commission_rate, idempotency_key, payload_hash
        ) values (
          v_lock.trip_id, v_uid, v_pnr, 'confirmed'::public.booking_status, p_payment_method,
          v_trip.price * v_seat_count,
          v_trip.commission_rate,   -- snapshot: later rate changes never move this booking's math
          p_idempotency_key, v_hash
        )
        returning id into v_booking_id;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'bookings_idempotency_key_key' then
          -- Belt-and-suspenders: the advisory lock above should make this
          -- unreachable. If it ever fires, replay rather than duplicate.
          v_replay := true;
        elsif v_constraint <> 'bookings_pnr_key' then
          raise;
        end if;
        v_conflict := true;
      end;

      if v_replay then
        select id, response_snapshot into v_booking_id, v_snapshot
        from bookings where idempotency_key = p_idempotency_key;
        return coalesce(
          v_snapshot,
          jsonb_build_object('ok', true, 'data', public.booking_ticket(v_booking_id)));
      end if;

      exit when not v_conflict;
    end loop;

    if v_conflict then
      raise exception 'PNR generation failed after % attempts', c_pnr_tries;
    end if;

    insert into booking_passengers (
      booking_id, trip_id, seat_number, full_name, phone, gender, active
    )
    select v_booking_id, v_lock.trip_id, e.seat_number, btrim(e.full_name),
           e.phone, e.gender::public.gender, true
    from (
      select value->>'seatNumber' as seat_number,
             value->>'fullName'   as full_name,
             value->>'phone'      as phone,
             value->>'gender'     as gender
      from jsonb_array_elements(p_passengers)
    ) e;

  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'booking_passengers_active_seat_uq' then
      raise;   -- not a seat collision — do not mislabel it
    end if;
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'SEAT_ALREADY_BOOKED', 'message', 'Some seats are already booked', 'details', null));
  end;

  -- ---------------------------------------------------------------------
  -- g/h. Consume the lock, then build the ticket (so availableSeats does not
  --      double-count the seats as both locked and booked), store the complete
  --      response as the replay snapshot, and return it.
  --      qrPayload is computed inside booking_ticket():
  --        {bookingId}.{hex HMAC-SHA256(bookingId||tripId, vault secret)}
  -- ---------------------------------------------------------------------
  delete from seat_locks where id = p_lock_id;   -- cascades seat_lock_seats

  v_ticket   := public.booking_ticket(v_booking_id);
  v_snapshot := jsonb_build_object('ok', true, 'data', v_ticket);

  update bookings set response_snapshot = v_snapshot where id = v_booking_id;

  return v_snapshot;
end;
$$;

revoke all on function public.create_booking(uuid, uuid, text, jsonb) from public;
grant  execute on function public.create_booking(uuid, uuid, text, jsonb) to anon, authenticated;

-- ===========================================================================
-- 6. cancel_booking (§4) — owner only, until cancel_window_hours before departure.
-- Sets status='cancelled' and every passenger active=false, which frees the seats
-- through the partial unique index (no seat table to update).
-- ===========================================================================
create or replace function public.cancel_booking(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_booking record;
  v_hours   int;

  -- A non-owner gets NOT_FOUND, not FORBIDDEN: booking ids must not be probeable
  -- for existence. Same envelope as a genuinely missing id.
  v_not_found constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'NOT_FOUND', 'message', 'Booking not found', 'details', null));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  select b.id, b.user_id, b.status, t.departure_at into v_booking
  from bookings b
  join trips t on t.id = b.trip_id
  where b.id = p_booking_id;

  if not found or v_booking.user_id is distinct from v_uid then
    return v_not_found;
  end if;

  -- Already cancelled → idempotent success (a retried cancel is not an error).
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'data', public.booking_ticket(p_booking_id));
  end if;

  select ((value)::text)::int into v_hours
  from app_config where key = 'cancel_window_hours';

  if v_booking.departure_at - now() <= make_interval(hours => v_hours) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'CANCEL_WINDOW_CLOSED', 'message', 'Too late to cancel this booking', 'details', null));
  end if;

  update bookings set status = 'cancelled' where id = p_booking_id;
  update booking_passengers set active = false where booking_id = p_booking_id;

  return jsonb_build_object('ok', true, 'data', public.booking_ticket(p_booking_id));
end;
$$;

revoke all on function public.cancel_booking(uuid) from public;
grant  execute on function public.cancel_booking(uuid) to anon, authenticated;

-- ===========================================================================
-- 7. get_booking (§4) — owner only, NOT_FOUND otherwise.
-- "Mine" listing is NOT here: it goes through PostgREST + the bookings_owner_read
-- RLS policy (supabase.from("bookings")…), paginated and ordered by the client.
-- ===========================================================================
create or replace function public.get_booking(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;

  v_not_found constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'NOT_FOUND', 'message', 'Booking not found', 'details', null));
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'UNAUTHORIZED', 'message', 'Sign in required', 'details', null));
  end if;

  select user_id into v_owner from bookings where id = p_id;

  -- Someone else's booking is indistinguishable from a missing one.
  if not found or v_owner is distinct from v_uid then
    return v_not_found;
  end if;

  return jsonb_build_object('ok', true, 'data', public.booking_ticket(p_id));
end;
$$;

revoke all on function public.get_booking(uuid) from public;
grant  execute on function public.get_booking(uuid) to anon, authenticated;

-- ===========================================================================
-- 8. lookup_booking (§4) — no auth, cross-device ticket retrieval.
--
-- The (pnr, phone) PAIR must match a passenger on that booking. Every miss —
-- wrong pnr, wrong phone, or rate-limited — returns the BYTE-IDENTICAL NOT_FOUND
-- envelope built from one constant below. Anything else (a different message, a
-- details field, even a different key order) turns this into an oracle that says
-- "this PNR exists, keep guessing the phone".
--
-- Rate limit: at most lookup_rate_limit_max attempts per PNR per
-- lookup_rate_limit_window_minutes. EVERY call is recorded — hits and misses
-- alike — because a ledger that only counts misses leaks which PNRs exist.
-- Recording happens BEFORE the limit test, so hammering a PNR keeps the window
-- rolling rather than buying a fresh one.
-- ===========================================================================
create or replace function public.lookup_booking(p_pnr text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pnr      text := upper(btrim(coalesce(p_pnr, '')));
  v_phone    text := btrim(coalesce(p_phone, ''));
  v_max      int;
  v_window   int;
  v_attempts int;
  v_id       uuid;

  v_not_found constant jsonb := jsonb_build_object('ok', false, 'error', jsonb_build_object(
    'code', 'NOT_FOUND', 'message', 'Booking not found', 'details', null));
begin
  select ((value)::text)::int into v_max
  from app_config where key = 'lookup_rate_limit_max';
  select ((value)::text)::int into v_window
  from app_config where key = 'lookup_rate_limit_window_minutes';

  insert into lookup_attempts (pnr) values (v_pnr);

  select count(*) into v_attempts
  from lookup_attempts
  where pnr = v_pnr
    and attempted_at > now() - make_interval(mins => v_window);

  if v_attempts > v_max then
    return v_not_found;
  end if;

  -- Cancelled bookings are still retrievable: the passenger needs to see the
  -- cancellation, and hiding them would re-open the enumeration oracle.
  select b.id into v_id
  from bookings b
  join booking_passengers bp on bp.booking_id = b.id
  where b.pnr = v_pnr
    and bp.phone = v_phone
  limit 1;

  if not found then
    return v_not_found;
  end if;

  return jsonb_build_object('ok', true, 'data', public.booking_ticket(v_id));
end;
$$;

revoke all on function public.lookup_booking(text, text) from public;
grant  execute on function public.lookup_booking(text, text) to anon, authenticated;
