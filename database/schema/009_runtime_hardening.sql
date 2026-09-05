-- Runtime role can execute only the narrow API functions.
create table if not exists private.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

insert into private.schema_migrations(version)
values ('20260904190000_initial_campuspay_neon')
on conflict (version) do nothing;

revoke all on schema private from public, campuspay_runtime;
revoke all on all tables in schema public from public, campuspay_runtime;
revoke all on all tables in schema private from public, campuspay_runtime;
revoke all on all sequences in schema private from public, campuspay_runtime;
revoke all on all functions in schema private from public, campuspay_runtime;
revoke all on all functions in schema api from public;
grant usage on schema api to campuspay_runtime;
grant execute on all functions in schema api to campuspay_runtime;

alter default privileges in schema public revoke all on tables from public, campuspay_runtime;
alter default privileges in schema private revoke all on tables from public, campuspay_runtime;
alter default privileges in schema private revoke all on sequences from public, campuspay_runtime;
alter default privileges in schema private revoke execute on functions from public, campuspay_runtime;
alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema api grant execute on functions to campuspay_runtime;
