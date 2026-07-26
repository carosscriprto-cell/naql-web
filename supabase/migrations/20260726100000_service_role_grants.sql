-- Foundational grant: give service_role full table access in public.
--
-- This project's new-table auto-expose is OFF (the new Supabase default), so
-- NOTHING is granted to the Data API roles implicitly — service_role included.
-- The trusted backend / test harness (serviceClient) arranges state that no
-- public RPC exposes yet (suspend a company, insert/expire a seat lock), so it
-- needs real privileges. service_role also has BYPASSRLS, but BYPASSRLS does not
-- substitute for table GRANTs. Idempotent: re-granting is a no-op.

grant all on all tables     in schema public to service_role;
grant all on all sequences  in schema public to service_role;
grant all on all functions  in schema public to service_role;

-- Future tables created by postgres in later migrations inherit the same.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
