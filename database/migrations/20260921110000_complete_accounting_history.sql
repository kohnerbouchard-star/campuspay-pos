-- Read-only operating history. No balances, cash events or historical migrations change.
create function private.validate_history_range(p_from date,p_to date,p_query text,p_offset integer,p_export boolean)
returns void language plpgsql immutable set search_path = '' as $$
begin
 if (p_from is null)<>(p_to is null) or (p_from is not null and (p_to<p_from or p_to-p_from>365))
  or p_query is null or length(p_query)>120 or p_query ~ '[[:cntrl:]]'
  or p_offset is null or p_offset<0 or p_export is null or (p_export and p_offset<>0) then raise exception 'BAD_REQUEST'; end if;
end $$;

create function api.student_wallet_history_page(p_session_id uuid,p_student_id uuid,p_from date,p_to date,p_query text,p_offset integer,p_export boolean)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare v_document jsonb;
begin
 perform private.assert_session(p_session_id,'wallet.read');
 perform private.validate_history_range(p_from,p_to,p_query,p_offset,p_export);
 if p_student_id is null then raise exception 'BAD_REQUEST'; end if;
 if not exists(select 1 from private.students s where s.id=p_student_id) then raise exception 'NOT_FOUND'; end if;
 with scoped as materialized (
  select l.id ledger_id,l.reference_number,l.amount_won,l.balance_before_won,l.balance_after_won,
   l.entry_type,l.reason_code,l.notes,l.created_at,coalesce(a.display_name,'Online store') actor_name
  from private.wallet_ledger l left join public.staff_profiles a on a.auth_user_id=l.staff_user_id
  where l.student_id=p_student_id
   and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Seoul'))
   and (p_to is null or l.created_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul'))
   and strpos(lower(concat_ws(' ',l.reference_number,l.entry_type,l.reason_code,l.notes,a.display_name)),lower(btrim(p_query)))>0
 ), totals as (select count(*) n,coalesce(sum(x.amount_won),0) amount from scoped x),
 page as (select x.* from scoped x order by x.created_at desc,x.ledger_id desc limit case when p_export then 50000 else 50 end offset p_offset),
 balance as (select w.balance_won,coalesce((select sum(l.amount_won) from private.wallet_ledger l where l.student_id=p_student_id),0) ledger_balance
   from private.wallets w where w.student_id=p_student_id)
 select jsonb_build_object('student_id',p_student_id,'from',p_from,'to',p_to,'query',btrim(p_query),'offset',p_offset,
  'total',totals.n,'net_amount_won',totals.amount,'generated_at',clock_timestamp(),
  'balance_won',(select b.balance_won from balance b),'ledger_balance_won',(select b.ledger_balance from balance b),
  'reconciliation_difference_won',(select b.balance_won-b.ledger_balance from balance b),
  'rows',case when p_export and totals.n>50000 then null else coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.ledger_id desc) from page x),'[]'::jsonb) end)
 into v_document from totals;
 if p_export and (v_document->>'total')::bigint>50000 then raise exception 'EXPORT_TOO_LARGE'; end if;
 return query select v_document;
end $$;

create function api.cash_history_page(p_session_id uuid,p_from date,p_to date,p_query text,p_offset integer,p_export boolean)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_document jsonb;
begin
 v_session:=private.cash_session(p_session_id);
 perform private.validate_history_range(p_from,p_to,p_query,p_offset,p_export);
 with scoped as materialized (
  select sh.id,sh.closed_at,sh.opening_float_won,c.expected_won,c.counted_won,c.variance_won,
   c.variance_won<>0 and review.shift_id is null review_required,
   opener.display_name opened_by_name,closer.display_name closed_by_name,approver.display_name approved_by_name
  from private.cash_shifts sh join private.cash_shift_closes c on c.shift_id=sh.id
   join private.terminals t on t.id=sh.terminal_id join public.staff_profiles opener on opener.auth_user_id=sh.opened_by
   join public.staff_profiles closer on closer.auth_user_id=c.closed_by
   left join private.cash_shift_approvals review on review.shift_id=sh.id
   left join public.staff_profiles approver on approver.auth_user_id=review.approved_by
  where sh.closed_at is not null and (v_session.role_snapshot in ('accountant','super_admin') or sh.terminal_id=v_session.terminal_id)
   and (p_from is null or sh.closed_at >= (p_from::timestamp at time zone 'Asia/Seoul'))
   and (p_to is null or sh.closed_at < ((p_to+1)::timestamp at time zone 'Asia/Seoul'))
   and strpos(lower(concat_ws(' ',sh.id::text,sh.terminal_id::text,t.label,opener.display_name,closer.display_name,c.notes,review.notes)),lower(btrim(p_query)))>0
 ), totals as (select count(*) n,coalesce(sum(x.opening_float_won),0) opening,coalesce(sum(x.expected_won),0) expected,
   coalesce(sum(x.counted_won),0) counted,coalesce(sum(x.variance_won),0) variance,count(*) filter(where x.review_required) unreviewed from scoped x),
 page as (select x.* from scoped x order by x.closed_at desc,x.id desc limit case when p_export then 50000 else 50 end offset p_offset)
 select jsonb_build_object('from',p_from,'to',p_to,'query',btrim(p_query),'offset',p_offset,'total',totals.n,'generated_at',clock_timestamp(),
  'scope',case when v_session.role_snapshot in ('accountant','super_admin') then 'ALL_TERMINALS' else 'CURRENT_TERMINAL' end,
  'opening_float_won',totals.opening,'expected_won',totals.expected,'counted_won',totals.counted,'variance_won',totals.variance,'unreviewed',totals.unreviewed,
  'rows',case when p_export and totals.n>50000 then null else coalesce((select jsonb_agg(jsonb_build_object('shift',private.cash_shift_document(x.id),
   'opened_by_name',x.opened_by_name,'closed_by_name',x.closed_by_name,'approved_by_name',x.approved_by_name) order by x.closed_at desc,x.id desc) from page x),'[]'::jsonb) end)
 into v_document from totals;
 if p_export and (v_document->>'total')::bigint>50000 then raise exception 'EXPORT_TOO_LARGE'; end if;
 return query select v_document;
end $$;
revoke all on function private.validate_history_range(date,date,text,integer,boolean) from public,campuspay_runtime;
revoke all on function api.student_wallet_history_page(uuid,uuid,date,date,text,integer,boolean),api.cash_history_page(uuid,date,date,text,integer,boolean) from public;
grant execute on function api.student_wallet_history_page(uuid,uuid,date,date,text,integer,boolean),api.cash_history_page(uuid,date,date,text,integer,boolean) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260921110000_complete_accounting_history') on conflict do nothing;
