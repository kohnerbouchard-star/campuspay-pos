create function private.funding_date_bounds(p_from date,p_to date) returns void
language plpgsql immutable set search_path = '' as $$
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>365 then raise exception 'BAD_REQUEST'; end if;
end $$;
create function api.funding_history(p_session_id uuid,p_from date,p_to date,p_offset integer default 0) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_finance boolean;
begin
 v_session:=private.funding_session(p_session_id); v_finance:=v_session.role_snapshot in ('accountant','super_admin');
 perform private.funding_date_bounds(p_from,p_to);
 if p_offset is null or p_offset<0 then raise exception 'BAD_REQUEST'; end if;
 return query with scoped as materialized (
  select o.* from private.funding_operations o where o.created_at >= (p_from::timestamp at time zone 'Asia/Seoul')
   and o.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (v_finance or (o.terminal_id=v_session.terminal_id and o.wallet_delta_won=0))
 ), page as (select x.id,x.created_at from scoped x order by x.created_at desc,x.id desc limit 50 offset p_offset)
 select jsonb_build_object('enabled',(select st.funding_enabled from private.system_settings st where st.singleton),
 'required',(select st.funding_required from private.system_settings st where st.singleton),'finance_access',v_finance,
 'from',p_from,'to',p_to,'offset',p_offset,'total',(select count(*) from scoped),
 'wallet_net_won',(select coalesce(sum(x.wallet_delta_won),0) from scoped x),
 'cash_in_won',(select coalesce(sum(greatest(x.cash_delta_won,0)),0) from scoped x),
 'cash_out_won',(select coalesce(sum(greatest(-x.cash_delta_won,0)),0) from scoped x),
 'rows',coalesce((select jsonb_agg(private.funding_receipt_document(x.id) order by x.created_at desc,x.id desc) from page x),'[]'::jsonb),
 'wallets_checked',case when v_finance then (select count(*) from private.wallets) else null end,
 'wallet_mismatches',case when v_finance then (select count(*) from private.wallets w
   left join (select l.student_id,sum(l.amount_won) total from private.wallet_ledger l group by l.student_id) balance on balance.student_id=w.student_id
   where w.balance_won<>coalesce(balance.total,0)) else null end,
 'closed_shifts_checked',(select count(*) from private.cash_shift_closes c join private.cash_shifts sh on sh.id=c.shift_id
   where c.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and c.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (v_finance or sh.terminal_id=v_session.terminal_id)),
 'closed_shift_mismatches',(select count(*) from private.cash_shift_closes c join private.cash_shifts sh on sh.id=c.shift_id
   where c.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and c.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (v_finance or sh.terminal_id=v_session.terminal_id)
   and c.expected_won<>sh.opening_float_won+coalesce((select sum(e.amount_won) from private.cash_shift_events e where e.shift_id=sh.id),0)),
 'unreviewed_variances',(select count(*) from private.cash_shift_closes c join private.cash_shifts sh on sh.id=c.shift_id
   where c.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and c.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (v_finance or sh.terminal_id=v_session.terminal_id) and c.variance_won<>0
   and not exists(select 1 from private.cash_shift_approvals a where a.shift_id=sh.id)),
 'unresolved_requests',(select count(*) from private.funding_intents i where i.state in ('PREPARED','SCANNED')
   and (v_finance or (i.terminal_id=v_session.terminal_id and i.wallet_delta_won=0))));
end $$;
-- A single-statement export snapshot: never silently export only the displayed page.
create function api.export_funding(p_session_id uuid,p_from date,p_to date) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_document jsonb;
begin
 v_session:=private.funding_session(p_session_id);
 perform private.funding_date_bounds(p_from,p_to);
 with scoped as materialized (
  select o.id,o.created_at,o.wallet_delta_won,o.cash_delta_won from private.funding_operations o
   where o.created_at >= (p_from::timestamp at time zone 'Asia/Seoul') and o.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul')
   and (v_session.role_snapshot in ('accountant','super_admin') or (o.terminal_id=v_session.terminal_id and o.wallet_delta_won=0))
 ), totals as (select count(*) n from scoped)
 select jsonb_build_object('total',totals.n,'from',p_from,'to',p_to,
  'rows',case when totals.n<=50000 then coalesce((select jsonb_agg(private.funding_receipt_document(x.id) order by x.created_at,x.id) from scoped x),'[]'::jsonb) else null end)
 into v_document from totals;
 if (v_document->>'total')::bigint>50000 then raise exception 'EXPORT_TOO_LARGE'; end if;
 return query select v_document;
end $$;
revoke all on function private.funding_date_bounds(date,date) from public,campuspay_runtime;
revoke all on function api.funding_history(uuid,date,date,integer),api.export_funding(uuid,date,date) from public;
grant execute on function api.funding_history(uuid,date,date,integer),api.export_funding(uuid,date,date) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260921092000_funding_reports') on conflict do nothing;
