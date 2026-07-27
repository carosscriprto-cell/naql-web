-- ===========================================================================
-- create_booking: read the lock and its seats in ONE statement.
--
-- BUG (fixed here). The previous version read the lock row in step (b) and its
-- seat set in step (d), as two separate statements. Under READ COMMITTED each
-- statement takes its own snapshot, so a competing caller's
-- `delete from seat_locks` (which cascades to seat_lock_seats) could commit
-- between them. This caller then saw a LIVE lock with an EMPTY seat set, fell
-- through to the passenger-coverage check, and returned
-- VALIDATION_ERROR / details.field = "passengers".
--
-- That is the wrong answer to "you lost a race". The frontend renders
-- VALIDATION_ERROR as a form-field error on the checkout form, while
-- LOCK_EXPIRED opens the expiry dialog and sends the passenger back to the seat
-- map. So the loser of a race was told their passenger data was invalid, with
-- no way forward — for data that was in fact correct.
--
-- FIX. Step (b) now selects the lock left-joined to its seats with array_agg,
-- in a single statement: both come from one snapshot, so either the lock and
-- its seats are both visible or neither is. Step (d) reuses that array instead
-- of re-reading the table.
--
-- Everything else — the (a)..(h) order, every validation, every error code and
-- message, every details payload — is unchanged from
-- 20260727120000_booking_rpcs.sql.
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
  -- b. Lock: exists AND owned by the caller AND unexpired AND still holds its
  --    seats.
  --
  --    A MISSING lock, an EXPIRED lock and ANOTHER USER'S lock all return the
  --    same LOCK_EXPIRED — never FORBIDDEN. FORBIDDEN would disclose that the
  --    lock exists and belongs to someone else, which is exactly what a caller
  --    probing lock ids wants to learn.
  --    Contrast release_lock (B3), which DOES return FORBIDDEN for a non-owner:
  --    there the caller names a lockId they claim to own, so telling them it is
  --    someone else's is the point of the call, not a leak.
  --
  --    ONE statement, deliberately: the seat array is aggregated here rather
  --    than re-read in (d). Under READ COMMITTED every statement takes a fresh
  --    snapshot, so two reads could straddle a competing caller's
  --    `delete from seat_locks` and observe a live lock with no seats. Joined
  --    here, both come from the same snapshot — the lock and its seats are
  --    visible together or not at all.
  --    left join, not join: a seat-less lock must still produce a row, so the
  --    invariant below can catch it instead of it vanishing into `not found`.
  -- ---------------------------------------------------------------------
  select sl.id, sl.trip_id, sl.owner_id, sl.expires_at,
         array_agg(s.seat_number order by s.seat_number)
           filter (where s.seat_number is not null) as seat_numbers
  into v_lock
  from seat_locks sl
  left join seat_lock_seats s on s.lock_id = sl.id
  where sl.id = p_lock_id
  group by sl.id, sl.trip_id, sl.owner_id, sl.expires_at;

  if not found
     or v_lock.owner_id is distinct from v_uid
     or v_lock.expires_at <= now() then
    return v_lock_expired;
  end if;

  -- Defensive invariant. A live lock with an empty seat set is IMPOSSIBLE by
  -- construction: lock_seats inserts seat_locks and seat_lock_seats in one
  -- transaction, so a committed lock always carries at least one seat. If it is
  -- ever observed, the only explanation is that the lock was consumed
  -- concurrently and this snapshot caught it mid-flight — which is exactly
  -- LOCK_EXPIRED. It must NEVER fall through to the passenger-coverage check
  -- below, which would blame the caller's passenger data for a lost race.
  if v_lock.seat_numbers is null or array_length(v_lock.seat_numbers, 1) is null then
    return v_lock_expired;
  end if;

  v_lock_seats := v_lock.seat_numbers;

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

  -- v_lock_seats came from the step (b) snapshot — no second read of
  -- seat_lock_seats, which is what created the race this migration fixes.
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
