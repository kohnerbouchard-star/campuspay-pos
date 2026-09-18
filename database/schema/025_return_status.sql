-- Enum additions commit before routines use the new state. No operational data changes.
alter type private.online_order_state add value if not exists 'RETURNED';
insert into private.schema_migrations(version) values('20260918170000_return_status') on conflict do nothing;
