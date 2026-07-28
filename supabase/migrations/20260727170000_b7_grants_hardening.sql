-- B7 / M7: grants hardening.
--
-- 1. Revoke service_role's EXECUTE on the three INTERNAL helpers.
-- 2. Generalise the T-SEC-1 introspection helper so the suite can audit ANY
--    role's execute surface, not just anon's.

-- ===========================================================================
-- 1. Internal helpers — defence in depth against the default-privileges grant.
--
-- 20260726100000_service_role_grants.sql runs
--   alter default privileges in schema public grant all on functions to service_role;
-- which hands service_role EXECUTE on every function created afterwards —
-- including qr_hmac_secret(), generate_pnr() and booking_ticket(), all three of
-- which carry an explicit `revoke ... from public, anon, authenticated` because
-- they are internals of create_booking / check_in and nothing else.
--
-- This changes no capability: service_role has BYPASSRLS and can read
-- vault.decrypted_secrets, bookings and booking_passengers directly, so nothing
-- it could do before becomes impossible now. What it removes is a SHORTCUT — a
-- leaked or over-shared service key can no longer ask the database to hand back
-- the QR signing key with a one-line rpc('qr_hmac_secret') call, or mint a
-- ticket body for an arbitrary booking id with no ownership check. Reaching the
-- same data now requires a deliberate table read, which is louder in logs and
-- harder to do by accident.
--
-- NOTE (systemic, deliberately NOT fixed here): the `alter default privileges`
-- above is still in force, so the NEXT internal helper anyone adds is granted to
-- service_role again on creation and will need its own revoke. Fixing that means
-- narrowing the default-privileges grant itself, which is a wider blast radius
-- than this task's scope. Flagged in the B7 report.
-- ===========================================================================
revoke execute on function public.qr_hmac_secret()        from service_role;
revoke execute on function public.generate_pnr()          from service_role;
revoke execute on function public.booking_ticket(uuid)    from service_role;

-- ===========================================================================
-- 2. role_executable_functions(role) — replaces anon_executable_functions().
--
-- Same job, one argument wider: T-SEC-1 needs anon's surface, and the assertion
-- added in B7 needs service_role's, so the helper takes the role name instead of
-- hard-coding 'anon'. The old zero-argument version is dropped rather than kept
-- alongside — two near-identical introspection functions is exactly the kind of
-- drift this audit exists to catch.
--
-- Returns `oid::regprocedure::text` ("get_trip(text)"), not bare names, so a
-- granted OVERLOAD of an expected RPC shows up as an extra entry instead of
-- hiding behind a name that is already on the allow-list.
--
-- has_function_privilege() accounts for grants made to PUBLIC as well as to the
-- role directly — the important case, because Postgres grants EXECUTE to PUBLIC
-- by default on every new function, so an RPC whose migration forgets its
-- `revoke ... from public` is anon-callable the moment it ships.
--
-- prokind is deliberately unfiltered: a procedure or aggregate reachable by anon
-- is exactly as interesting as a function.
-- ===========================================================================
drop function if exists public.anon_executable_functions();

create or replace function public.role_executable_functions(p_role text)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result text[];
begin
  -- A typo'd role name would otherwise raise inside has_function_privilege and
  -- surface as a transport error rather than a readable test failure.
  if not exists (select 1 from pg_roles where rolname = p_role) then
    raise exception 'role % does not exist', p_role using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(
           array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),
           '{}'::text[])
  into v_result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege(p_role, p.oid, 'EXECUTE');

  return v_result;
end;
$$;

-- Introspecting the grant table is itself privileged: an anonymous caller has no
-- business enumerating the attack surface. Granted explicitly to service_role
-- rather than relying on the default privileges above, so this keeps working if
-- those are ever narrowed.
revoke all on function public.role_executable_functions(text) from public, anon, authenticated;
grant  execute on function public.role_executable_functions(text) to service_role;
