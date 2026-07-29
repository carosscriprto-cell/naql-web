# Manual migration runbook — hosted DEV (`gidodxojpvztrsihnqxj`)

**Why this exists.** Outbound TCP/5432 is blackholed on this network: the handshake completes and the
stream is then swallowed. Proven by sending an 8-byte `SSLRequest` to the **same peer IP** on two ports —
6543 replies `S` in milliseconds, 5432 times out; 443 answers normally; four IPs across both pooler
generations behave identically, with no local firewall rule. Session mode (5432) is the only mode that
carries DDL, so `supabase migration up` cannot run from here. These five migrations are therefore applied
by pasting the **verbatim file contents** into the dashboard SQL editor.

This is permitted; authoring SQL in the editor is not. The invariant is that every schema change exists as
a file in `supabase/migrations/` — see `CLAUDE.md` → Migrations.

**Order is not optional.** Two of these five drop objects that an earlier one creates. Pasted out of
order, the drops silently no-op (`if exists`) and the objects survive as drift that CI's from-zero
rebuild will not reproduce.

---

## Overview

| # | filename | lines | what it changes | objects created / dropped | risk to watch |
|---|---|---|---|---|---|
| 1 | `20260727150000_create_booking_row_lock_and_grants_audit.sql` | 497 | Replaces `create_booking` so the seat-lock row is read `FOR UPDATE`. Adds the T-SEC-1 grants-audit helper. | **replaces** `create_booking(uuid,uuid,text,jsonb)` · **creates** `anon_executable_functions()` | Partial paste. The body is 390 lines; if the trailing `revoke`/`grant` pair at 447–448 is missed, `create_booking` keeps the default `PUBLIC EXECUTE`. |
| 2 | `20260727160000_operator_rpcs.sql` | 837 | All of BACKEND_V1 §5: trips CRUD, manifest, check-in, buses, summary. | **creates 12 functions:** `operator_trip_json`, `create_trip`, `update_trip`, `cancel_trip`, `get_manifest`, `check_in_booking`, `check_in`, `check_in_by_pnr`, `operator_cancel_booking`, `create_bus`, `update_bus`, `operator_summary` | Longest file by far — editor truncation on paste. Each function has its own `revoke`/`grant` pair; a truncated paste leaves later functions ungranted *and* unrevoked. |
| 3 | `20260727170000_b7_grants_hardening.sql` | 93 | Narrows the grant surface: strips 3 internal helpers from `service_role`, generalises the audit helper. | **drops** `anon_executable_functions()` ⚠️ · **creates** `role_executable_functions(text)` · **revokes** `EXECUTE` from `service_role` on `qr_hmac_secret()`, `generate_pnr()`, `booking_ticket(uuid)` | **Drops what #1 creates.** Run before #1 and the drop no-ops, then #1 re-creates the helper and it survives forever. `tests/db/security.test.ts` asserts this exact surface. |
| 4 | `20260727170500_get_trip_accepts_text_id.sql` | 107 | `get_trip` takes `text` and validates, so a malformed URL id returns `NOT_FOUND` instead of SQLSTATE 22P02. | **drops** `get_trip(uuid)` ⚠️ · **creates** `get_trip(text)` | Both overloads existing at once makes PostgREST's argument resolution ambiguous and breaks T-SEC-1's routine count. The drop must land. |
| 5 | `20260728100000_realtime_seat_map_version.sql` | 140 | Realtime fan-out signal for the seat map — a counter table bumped by triggers, carrying no passenger data. | **creates** table `trip_seat_map_version`, function `bump_seat_map_version()`, 2 triggers, 1 RLS policy, publication membership | **The only non-idempotent file.** `create table` / `create trigger` / `create policy` have no `if not exists`; a second run fails with `42P07` / `42710`. Also adds triggers to `seat_lock_seats` and `booking_passengers` — the two hottest write paths. |

Files 1–4 are re-runnable (`create or replace`, `drop … if exists`). File 5 is not.

---

## Step 1 — `20260727150000_create_booking_row_lock_and_grants_audit.sql`

1. Open `supabase/migrations/20260727150000_create_booking_row_lock_and_grants_audit.sql`.
2. **Copy the ENTIRE file** — do not skip the header comment or the trailing `GRANT`/`REVOKE` lines
   (447–448 and 496–497). Paste and run.
3. Record the version:
   ```sql
   insert into supabase_migrations.schema_migrations (version) values ('20260727150000');
   ```
4. Verify — the row lock is what this migration exists for, so check for it in the function body, not
   just for the function's existence (`create_booking` already exists; a no-op paste would look fine):
   ```sql
   select
     position('for update' in lower(prosrc)) > 0        as has_row_lock,
     to_regprocedure('public.anon_executable_functions()') is not null as audit_helper_present
   from pg_proc
   where oid = 'public.create_booking(uuid,uuid,text,jsonb)'::regprocedure;
   ```
   **Expect exactly one row, both columns `true`.** `has_row_lock = false` means the old body is still
   installed — the paste did not take.
5. Most likely error: **`42P13 cannot change return type of existing function`**. Means a
   `create_booking` with a different signature exists; you pasted a fragment rather than the whole file.
   The silent failure is worse than the loud one: no error, but `has_row_lock` comes back `false`.

## Step 2 — `20260727160000_operator_rpcs.sql`

1. Open `supabase/migrations/20260727160000_operator_rpcs.sql`.
2. **Copy the ENTIRE file** — 837 lines, header comment through line 837. This is the one most likely to
   be truncated by the editor; confirm the last line you pasted is
   `grant  execute on function public.operator_summary(date, date) to authenticated;`.
3. Record the version:
   ```sql
   insert into supabase_migrations.schema_migrations (version) values ('20260727160000');
   ```
4. Verify — count all twelve, and confirm none leaked to `anon`:
   ```sql
   select
     count(*) filter (where p.proname in (
       'operator_trip_json','create_trip','update_trip','cancel_trip','get_manifest',
       'check_in_booking','check_in','check_in_by_pnr','operator_cancel_booking',
       'create_bus','update_bus','operator_summary'))                     as functions_present,
     count(*) filter (where has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_callable
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'operator_trip_json','create_trip','update_trip','cancel_trip','get_manifest',
       'check_in_booking','check_in','check_in_by_pnr','operator_cancel_booking',
       'create_bus','update_bus','operator_summary');
   ```
   **Expect `functions_present = 12` and `anon_callable = 0`.** Fewer than 12 = truncated paste. Any
   `anon_callable > 0` = a `revoke` line was cut off; re-run the whole file.
5. Most likely error: **`42883 function public.qr_hmac_secret() does not exist`** from inside `check_in`.
   Means `20260727120000_booking_rpcs.sql` is not applied — stop and check `npm run db:list`, because the
   pending set is then not the five assumed here.

## Step 3 — `20260727170000_b7_grants_hardening.sql` ⚠️ DROPS

1. Open `supabase/migrations/20260727170000_b7_grants_hardening.sql`.
2. **Copy the ENTIRE file** — do not skip the header comment or the trailing `GRANT`/`REVOKE` lines
   (92–93).
3. Record the version:
   ```sql
   insert into supabase_migrations.schema_migrations (version) values ('20260727170000');
   ```
4. Verify — this migration is defined by what it *removes*, so check the absences:
   ```sql
   select
     to_regprocedure('public.anon_executable_functions()')  is null      as old_helper_dropped,
     to_regprocedure('public.role_executable_functions(text)') is not null as new_helper_present,
     has_function_privilege('service_role','public.qr_hmac_secret()','EXECUTE')  as svc_qr,
     has_function_privilege('service_role','public.generate_pnr()','EXECUTE')    as svc_pnr,
     has_function_privilege('service_role','public.booking_ticket(uuid)','EXECUTE') as svc_ticket;
   ```
   **Expect `true, true, false, false, false`.** All three `svc_*` must be `false`; each is asserted by
   `tests/db/security.test.ts` → *"service_role cannot execute the internal helpers"*.
5. Most likely error: **none — and that is the trap.** `drop function if exists` succeeds whether or not
   the target is there. If you ran this before Step 1, `old_helper_dropped` reads `true` here, then
   Step 1 re-creates `anon_executable_functions()` and nothing ever removes it again. CI rebuilds from
   zero in the correct order and never sees it, so the drift is invisible until a grants audit disagrees
   between DEV and CI. If that happened: run this file again, after Step 1.

## Step 4 — `20260727170500_get_trip_accepts_text_id.sql` ⚠️ DROPS

1. Open `supabase/migrations/20260727170500_get_trip_accepts_text_id.sql`.
2. **Copy the ENTIRE file** — do not skip the header comment or the trailing `GRANT`/`REVOKE` lines
   (106–107).
3. Record the version:
   ```sql
   insert into supabase_migrations.schema_migrations (version) values ('20260727170500');
   ```
4. Verify — exactly one `get_trip` routine must remain, and it must be the `text` one:
   ```sql
   select
     to_regprocedure('public.get_trip(uuid)') is null     as uuid_overload_dropped,
     to_regprocedure('public.get_trip(text)') is not null  as text_version_present,
     (select count(*) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'get_trip') as get_trip_routines;
   ```
   **Expect `true, true, 1`.** A `get_trip_routines` of `2` is the failure this migration's header warns
   about: PostgREST cannot resolve the call, and T-SEC-1 counts routines, not names.
5. Most likely error: **no SQL error, but the API still returns `22P02`** for
   `get_trip('not-a-uuid')`. That is the PostgREST schema cache still holding the `uuid` signature and
   casting the argument before dispatch — fixed by the `notify pgrst` in the post-run checks, not by
   re-running this file.

## Step 5 — `20260728100000_realtime_seat_map_version.sql` (not re-runnable)

1. Open `supabase/migrations/20260728100000_realtime_seat_map_version.sql`.
2. **Copy the ENTIRE file** — header comment through the closing `end $$;` of the publication block at
   line 140. Do not skip the `revoke` at line 77 or the `grant` at line 113.
3. Record the version:
   ```sql
   insert into supabase_migrations.schema_migrations (version) values ('20260728100000');
   ```
4. Verify — table, both triggers, and publication membership:
   ```sql
   select
     to_regclass('public.trip_seat_map_version') is not null as table_present,
     (select count(*) from pg_trigger
       where tgname in ('seat_lock_seats_bump_seat_map_version',
                        'booking_passengers_bump_seat_map_version')) as triggers_present,
     (select count(*) from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'trip_seat_map_version')                     as in_publication;
   ```
   **Expect `true, 2, 1`.** `triggers_present = 1` means a partial paste — the seat map will then miss
   either lock or booking changes, which looks like an intermittently stale map, not an error.
5. Most likely error: **`42P07 relation "trip_seat_map_version" already exists`** (or `42710` for a
   trigger/policy). This file has no `if not exists` guards, so that means it partly ran before. Do
   **not** hand-edit the file to skip the created objects — drop what it created and re-run the whole
   file:
   ```sql
   drop trigger if exists seat_lock_seats_bump_seat_map_version on public.seat_lock_seats;
   drop trigger if exists booking_passengers_bump_seat_map_version on public.booking_passengers;
   drop table if exists public.trip_seat_map_version;   -- publication membership goes with it
   drop function if exists public.bump_seat_map_version();
   ```

---

## Post-run checks

```sql
-- Operational, not schema: PostgREST caches the function/table list and will keep
-- answering PGRST202 for everything above until told otherwise.
notify pgrst, 'reload schema';
```

```bash
npm run db:list     # expect all 13 versions present in Remote, 0 pending
npm run db:types    # regenerates src/types/database.ts (works over 6543 — Management API, not 5432)
git diff --stat     # expect ONLY src/types/database.ts, roughly +120 lines
```

`npm run db:types` is the step CI is currently failing on
(*"Generated types are committed and fresh"*): the committed file was generated against 8 migrations and
is missing `trip_seat_map_version` plus the fourteen functions added above. Commit the regenerated file.

Then re-run `npm run db:test`. Anything still failing after this is real.

---

# DATA — refreshing the departed demo trips

> **This is not schema, not a migration, and must not be pasted into a migration file.** It repairs seeded
> *rows* on DEV only. PROD never runs the seed at all.

**Why the seed cannot do it.** `supabase/seed.sql` computes every departure relatively —
`(current_date + t.day)::timestamp at time zone 'Asia/Damascus'` — so it is correct *at the moment it
runs*. But its inserts end in `on conflict (id) do nothing`, so re-running it against a database that
already holds those uuids updates nothing. The rows keep whatever `current_date` was on the day DEV was
seeded (2026-07-27), and the fixed-uuid demo trips have since departed:

| trip | intended | actual on DEV |
|---|---|---|
| `…0001` (and `…0002`–`…0012`) | tomorrow, published | departed 2026-07-28T04:00Z |
| `…0013` | departed fixture | departed — correct |
| `…0014` | **future**, fully booked | departed 2026-07-28T09:00Z — **wrong** |

The bulk trips (`day` 2–14) are still mostly future, which is why only the fixed-uuid fixtures break.

**Option A — full reset (preferred).** `supabase db reset` drops everything, replays all 13 migrations
and re-runs the seed, so `current_date` is re-evaluated. Needs port 5432, so it must run from a network
that permits it or from the `DB migrate (manual)` workflow with `action: reset`. This also makes every
step above unnecessary.

**Option B — re-date the rows in place.** Only when a reset is not available. Shifts the fixed-uuid demo
trips so they sit the same distance from *today* that the seed intended, preserving each trip's
Damascus-local wall-clock time and its duration:

```sql
-- Trips 1..12 and 14: seed intent is "tomorrow". Trip 13 stays departed (yesterday).
update public.trips t
set    departure_at = departure_at + make_interval(days => d.shift),
       arrival_at   = arrival_at   + make_interval(days => d.shift)
from (
  select id,
         (current_date + case when id = '000000e1-0000-4000-8000-000000000013' then -1 else 1 end)
         - (departure_at at time zone 'Asia/Damascus')::date as shift
  from public.trips
  where id::text like '000000e1-0000-4000-8000-0000000000%'
) d
where t.id = d.id
  and d.shift <> 0;
```

Verify — 13 must be the only departed one, and 14 must be future:

```sql
select id, departure_at, departure_at > now() as is_future
from public.trips
where id::text like '000000e1-0000-4000-8000-0000000000%'
order by id;
```

**Expect `is_future = true` for every trip except `…0013`.** Trip `…0015` is the `draft` RLS fixture and
is future too. This changes no schema and records no migration version.
