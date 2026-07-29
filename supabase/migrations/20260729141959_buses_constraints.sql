-- B8: constrain the two `buses` columns the frontend parses strictly.
--
-- THE FAILURE THESE PREVENT is not a bad card — it is a blank page. Both
-- columns feed zod schemas that parse a WHOLE COLLECTION at once:
--
--   buses.bus_type → search_trips / get_trip / booking_ticket emit it as
--     `busType`, and tripSearchItemSchema requires z.enum(["عادي","VIP"])
--     (src/features/search/schemas.ts). tripSearchListSchema is
--     z.array(tripSearchItemSchema), so ONE bus with a third type fails the
--     parse for the entire array — /search renders its error state for every
--     trip that company runs, not one broken card.
--
--   buses.layout → get_seat_map returns it as a raw jsonb passthrough
--     (20260726141549), and seatMapSchema requires { rows, cols, aisleAfterCol }
--     all present and integer. A layout missing one key fails the seat-map
--     parse and the trip becomes unbookable.
--
-- `create_bus` already validates both (20260727160000_operator_rpcs.sql), but
-- it is not the only writer: service_role, a future admin RPC, and any manual
-- fix-up bypass it entirely. These CHECKs are the guarantee that does not
-- depend on remembering.
--
-- ===========================================================================
-- PRE-FLIGHT — run this BEFORE applying. It must return ZERO rows.
--
-- Each row it returns is a bus that the constraint below would reject, and the
-- ALTER would then fail with 23514 and change nothing. Fix the data first.
--
--   select id, company_id, plate_number, bus_type, layout
--   from public.buses
--   where bus_type not in ('عادي', 'VIP')
--      or jsonb_typeof(layout) is distinct from 'object'
--      or (layout ->> 'rows')          is null or (layout ->> 'rows')          !~ '^[0-9]+$' or (layout ->> 'rows')::int          < 1
--      or (layout ->> 'cols')          is null or (layout ->> 'cols')          !~ '^[0-9]+$' or (layout ->> 'cols')::int          < 1
--      or (layout ->> 'aisleAfterCol') is null or (layout ->> 'aisleAfterCol') !~ '^[0-9]+$';
--
-- Expected to pass today, from the repo (not from a live query):
--   · supabase/seed.sql inserts 6 buses, all 'VIP' or 'عادي',
--     all layout {"rows":12,"cols":4,"aisleAfterCol":2}.
--   · tests/db/operator.test.ts writes only 'VIP' / 'عادي' and the layouts
--     {1,1,1} {2,2,1} {8,4,2} {10,4,2} {12,4,2} — every one satisfies the
--     predicate above.
-- ===========================================================================

-- ===========================================================================
-- 1. bus_type — exactly the two values the zod enum admits.
--
-- A CHECK, not a Postgres enum: an enum is a type change, so every function
-- with `bus_type text` in a signature or a local variable would have to move
-- with it, and adding a third type later would need ALTER TYPE ... ADD VALUE
-- (which cannot run inside a transaction block, i.e. not pasteable in the SQL
-- editor alongside anything else). A CHECK is a one-line edit in a future
-- migration and touches nothing else.
--
-- The values are NOT trimmed or case-folded here on purpose: create_bus and
-- update_bus already `btrim()` on the way in, so a stored value with
-- whitespace would itself be the bug this is meant to catch.
-- ===========================================================================
alter table public.buses drop constraint if exists buses_bus_type_check;

alter table public.buses
  add constraint buses_bus_type_check
  check (bus_type in ('عادي', 'VIP'));

comment on constraint buses_bus_type_check on public.buses is
  'busType must match z.enum(["عادي","VIP"]) in src/features/search/schemas.ts — a third value fails the parse of the WHOLE search_trips array, not one card.';

-- ===========================================================================
-- 2. layout — the three keys get_seat_map hands to seatMapSchema.
--
-- The predicate is COPIED FROM create_bus (20260727160000, the p_layout guard)
-- rather than tightened, so the constraint can never reject a row that
-- create_bus would have accepted. Keeping them identical matters: if this were
-- stricter, create_bus would start failing with a raw 23514 instead of its
-- VALIDATION_ERROR envelope, which is exactly the RAISE-instead-of-RETURN that
-- CLAUDE.md forbids.
--
-- That means, deliberately:
--   · rows >= 1 and cols >= 1 — a zero-row bus has no seats to sell;
--   · aisleAfterCol >= 0 — NOT >= 1. create_bus imposes no lower bound on it
--     and 0 is meaningful (an aisle before the first column, i.e. none), even
--     though create_bus's error MESSAGE says "positive". See the note in the
--     B8 report; the message is what is wrong, not this bound.
--   · `^[0-9]+$` on the TEXT form rejects 12.5 and -3, which jsonb_typeof
--     alone would call 'number'.
--   · extra keys are allowed — seatMapSchema ignores them, and forbidding them
--     would break a future layout field before the frontend could read it.
-- ===========================================================================
alter table public.buses drop constraint if exists buses_layout_shape_check;

alter table public.buses
  add constraint buses_layout_shape_check
  check (
    jsonb_typeof(layout) = 'object'
    and (layout ->> 'rows')          is not null
    and (layout ->> 'rows')          ~ '^[0-9]+$'
    and (layout ->> 'rows')::int     >= 1
    and (layout ->> 'cols')          is not null
    and (layout ->> 'cols')          ~ '^[0-9]+$'
    and (layout ->> 'cols')::int     >= 1
    and (layout ->> 'aisleAfterCol') is not null
    and (layout ->> 'aisleAfterCol') ~ '^[0-9]+$'
  );

comment on constraint buses_layout_shape_check on public.buses is
  'layout must satisfy seatMapSchema { rows, cols, aisleAfterCol } — get_seat_map passes this column through verbatim. Predicate mirrors create_bus so the RPC keeps returning VALIDATION_ERROR rather than raising 23514.';
