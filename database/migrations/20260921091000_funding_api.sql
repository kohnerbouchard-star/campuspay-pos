create function private.funding_session(p_session_id uuid) returns private.staff_sessions
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions;
begin
 v_session:=private.cash_session(p_session_id);
 if v_session.role_snapshot not in ('cashier','accountant','super_admin') then raise exception 'FORBIDDEN'; end if;
 return v_session;
end $$;
create function private.funding_intent_document(p_key uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('request_key',i.request_key,'action',i.action,'state',i.state,
 'wallet_delta_won',i.wallet_delta_won,'cash_delta_won',i.cash_delta_won,'cash_received_won',i.cash_received_won,'change_won',i.change_won,
 'shift_id',i.shift_id,'student_id',i.student_id,'student_name',s.display_name,'student_code',s.student_code,'year_group',s.year_group,
 'balance_won',w.balance_won,'source_reference',i.source_reference,'notes',i.notes,'expires_at',i.expires_at,
 'original_reference',o.reference_number,'requires_card',i.wallet_delta_won<>0,'requires_approval',i.action<>'CASH_DEPOSIT')
 from private.funding_intents i left join private.students s on s.id=i.student_id
 left join private.wallets w on w.student_id=i.student_id left join private.funding_operations o on o.id=i.original_id
 where i.request_key=p_key;
$$;
create function private.funding_receipt_document(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
 select jsonb_build_object('operation_id',o.id,'request_key',o.request_key,'reference_number',o.reference_number,'action',o.action,
 'wallet_delta_won',o.wallet_delta_won,'cash_delta_won',o.cash_delta_won,'cash_received_won',o.cash_received_won,'change_won',o.change_won,
 'balance_before_won',o.balance_before_won,'balance_after_won',o.balance_after_won,'student_code',s.student_code,'student_name',s.display_name,
 'shift_id',o.shift_id,'terminal_id',o.terminal_id,'terminal_label',t.label,'actor_name',a.display_name,'approver_name',p.display_name,
 'source_reference',o.source_reference,'notes',o.notes,'created_at',o.created_at,'original_reference',original.reference_number,
 'reversed_by_reference',(select r.reference_number from private.funding_operations r where r.original_id=o.id))
 from private.funding_operations o join private.terminals t on t.id=o.terminal_id join public.staff_profiles a on a.auth_user_id=o.actor_id
 left join public.staff_profiles p on p.auth_user_id=o.approved_by left join private.students s on s.id=o.student_id
 left join private.funding_operations original on original.id=o.original_id where o.id=p_id;
$$;
create function api.prepare_funding(p_session_id uuid,p_key uuid,p_action text,p_payload jsonb) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_intent private.funding_intents; v_original private.funding_operations;
 v_shift private.cash_shifts; v_proof text; v_value jsonb; v_amount bigint:=0; v_wallet bigint:=0; v_cash bigint:=0; v_received bigint:=0; v_change bigint:=0;
 v_source text; v_notes text; v_allowed text[];
begin
 v_session:=private.funding_session(p_session_id);
 if p_key is null or p_action is null or p_action not in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT','REVERSE_FUNDING','PAID_IN','PAID_OUT','CASH_DROP')
  or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'BAD_REQUEST'; end if;
 if p_action in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT','REVERSE_FUNDING') and v_session.role_snapshot not in ('accountant','super_admin') then raise exception 'FORBIDDEN'; end if;
 v_source:=btrim(p_payload->>'source_reference'); v_notes:=btrim(p_payload->>'notes');
 if v_source is null or length(v_source) not between 3 and 120 or v_source ~ '[[:cntrl:]]'
  or v_notes is null or length(v_notes) not between 10 and 500 or v_notes ~ '[[:cntrl:]]' then raise exception 'BAD_REQUEST'; end if;
 v_allowed:=array['source_reference','notes']||case when p_action='CASH_DEPOSIT' then array['denominations','cash_received_won']
  when p_action in ('NONCASH_CREDIT','ADMIN_DEBIT') then array['denominations']
  when p_action='REVERSE_FUNDING' then array['original_reference'] else array['counts'] end;
 if exists(select 1 from jsonb_object_keys(p_payload) as k(name) where k.name<>all(v_allowed)) then raise exception 'BAD_REQUEST'; end if;
 v_proof:=encode(extensions.digest(jsonb_build_array(p_action,p_payload)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('funding:'||p_key::text,0));
 if exists(select 1 from private.funding_closures c where c.request_key=p_key) then raise exception 'CONFLICT'; end if;
 select i.* into v_intent from private.funding_intents i where i.request_key=p_key for update;
 if found then
  if v_intent.actor_id<>v_session.auth_user_id or v_intent.terminal_id<>v_session.terminal_id or v_intent.request_proof<>v_proof then raise exception 'CONFLICT'; end if;
  return query select private.funding_intent_document(p_key); return;
 end if;
 perform 1 from private.system_settings st where st.singleton for share;
 if not (select st.funding_enabled from private.system_settings st where st.singleton) then raise exception 'FUNDING_DISABLED'; end if;
 if p_action in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT') then
  if jsonb_typeof(p_payload->'denominations') is distinct from 'array' then raise exception 'BAD_REQUEST'; end if;
  if jsonb_array_length(p_payload->'denominations') not between 1 and 30 then raise exception 'BAD_REQUEST'; end if;
  for v_value in select * from jsonb_array_elements(p_payload->'denominations') loop
   if jsonb_typeof(v_value)<>'number' or v_value::text not in ('1000','5000','10000','20000','50000') then raise exception 'BAD_REQUEST'; end if;
   v_amount:=v_amount+(v_value::text)::bigint;
  end loop;
  v_wallet:=case when p_action='ADMIN_DEBIT' then -v_amount else v_amount end;
  if p_action='CASH_DEPOSIT' then
   if jsonb_typeof(p_payload->'cash_received_won') is distinct from 'number' or p_payload->>'cash_received_won' !~ '^[0-9]{1,10}$' then raise exception 'BAD_REQUEST'; end if;
   v_received:=(p_payload->>'cash_received_won')::bigint;
   if v_received<v_amount or v_received>1000000000 then raise exception 'BAD_REQUEST'; end if;
   v_cash:=v_amount; v_change:=v_received-v_amount;
  end if;
 elsif p_action='REVERSE_FUNDING' then
  select o.* into v_original from private.funding_operations o where o.reference_number=p_payload->>'original_reference';
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_original.action not in ('CASH_DEPOSIT','NONCASH_CREDIT','ADMIN_DEBIT') or exists(select 1 from private.funding_operations o where o.original_id=v_original.id) then raise exception 'CONFLICT'; end if;
  v_wallet:=-v_original.wallet_delta_won; v_cash:=-v_original.cash_delta_won;
 else
  v_amount:=private.cash_denominations_total(p_payload->'counts');
  if v_amount<=0 then raise exception 'BAD_REQUEST'; end if;
  v_cash:=case when p_action='PAID_IN' then v_amount else -v_amount end;
  v_received:=case when p_action='PAID_IN' then v_amount else 0 end;
 end if;
 if v_cash<>0 then
  if not (select st.cash_controls_enabled from private.system_settings st where st.singleton) then raise exception 'CASH_CONTROLS_DISABLED'; end if;
  select sh.* into v_shift from private.cash_shifts sh where sh.terminal_id=v_session.terminal_id and sh.closed_at is null for update;
  if not found then raise exception 'CASH_SHIFT_REQUIRED'; end if;
  if v_shift.opened_by<>v_session.auth_user_id and v_session.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 end if;
 insert into private.funding_intents(request_key,actor_id,terminal_id,action,request_proof,wallet_delta_won,cash_delta_won,
  cash_received_won,change_won,shift_id,student_id,original_id,source_reference,notes,expires_at)
 values(p_key,v_session.auth_user_id,v_session.terminal_id,p_action,v_proof,v_wallet,v_cash,v_received,v_change,v_shift.id,
  v_original.student_id,v_original.id,v_source,v_notes,clock_timestamp()+interval '5 minutes');
 return query select private.funding_intent_document(p_key);
end $$;
create function api.scan_funding_card(p_session_id uuid,p_key uuid,p_card_fingerprint text) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_intent private.funding_intents; v_card private.student_cards;
begin
 v_session:=private.assert_session(p_session_id,'wallet.adjust');
 if p_key is null or p_card_fingerprint is null or p_card_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('funding:'||p_key::text,0));
 select i.* into v_intent from private.funding_intents i where i.request_key=p_key for update;
 if not found or v_intent.actor_id<>v_session.auth_user_id or v_intent.terminal_id<>v_session.terminal_id then raise exception 'NOT_FOUND'; end if;
 if v_intent.wallet_delta_won=0 or v_intent.state not in ('PREPARED','SCANNED') or v_intent.expires_at<=clock_timestamp() then raise exception 'CONFLICT'; end if;
 select c.* into v_card from private.student_cards c join private.students s on s.id=c.student_id
 where c.card_fingerprint=p_card_fingerprint and c.active and s.active;
 if not found then raise exception 'NOT_FOUND'; end if;
 if (v_intent.student_id is not null and v_intent.student_id<>v_card.student_id) or (v_intent.card_id is not null and v_intent.card_id<>v_card.id) then raise exception 'CONFLICT'; end if;
 update private.funding_intents set student_id=v_card.student_id,card_id=v_card.id,state='SCANNED' where request_key=p_key;
 return query select private.funding_intent_document(p_key);
end $$;
create function api.confirm_funding(p_session_id uuid,p_key uuid,p_student_pin_proof text,p_approver_code text,p_approver_proof text,p_verified boolean)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_intent private.funding_intents; v_operation private.funding_operations;
 v_original private.funding_operations; v_approver public.staff_profiles; v_credential private.student_credentials;
 v_wallet private.wallets; v_shift private.cash_shifts; v_id uuid; v_ledger uuid; v_reference text; v_expected bigint;
 v_before bigint; v_after bigint; v_now timestamptz;
begin
 v_session:=private.funding_session(p_session_id);
 if p_key is null or p_verified is distinct from true then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('funding:'||p_key::text,0));
 select i.* into v_intent from private.funding_intents i where i.request_key=p_key for update;
 if not found or v_intent.actor_id<>v_session.auth_user_id or v_intent.terminal_id<>v_session.terminal_id then raise exception 'NOT_FOUND'; end if;
 if v_intent.wallet_delta_won<>0 and v_session.role_snapshot not in ('accountant','super_admin') then raise exception 'FORBIDDEN'; end if;
 select o.* into v_operation from private.funding_operations o where o.request_key=p_key;
 if found then return query select jsonb_build_object('outcome','COMPLETED','receipt',private.funding_receipt_document(v_operation.id)); return; end if;
 if v_intent.state='CLOSED' or exists(select 1 from private.funding_closures c where c.request_key=p_key) then
  return query select jsonb_build_object('outcome','CLOSED'); return;
 end if;
 if v_intent.expires_at<=clock_timestamp() then
  update private.funding_intents set state='CLOSED' where request_key=p_key;
  return query select jsonb_build_object('outcome','CLOSED'); return;
 end if;
 perform 1 from private.system_settings st where st.singleton for share;
 if not (select st.funding_enabled from private.system_settings st where st.singleton) then raise exception 'FUNDING_DISABLED'; end if;
 if v_intent.action<>'CASH_DEPOSIT' then
  v_approver:=private.verify_staff_pin(p_approver_code,p_approver_proof,null);
  if v_approver.auth_user_id is null then
   return query select jsonb_build_object('outcome','REJECTED','error_code','APPROVAL_FAILED'); return;
  end if;
  if v_approver.auth_user_id=v_session.auth_user_id or
   (v_intent.wallet_delta_won<>0 and v_approver.role<>'super_admin') or
   (v_intent.wallet_delta_won=0 and v_approver.role not in ('accountant','super_admin')) then raise exception 'FORBIDDEN'; end if;
 end if;
 if v_intent.original_id is not null then
  select o.* into v_original from private.funding_operations o where o.id=v_intent.original_id for update;
  if exists(select 1 from private.funding_operations o where o.original_id=v_original.id) then raise exception 'CONFLICT'; end if;
 end if;
 -- Each financial writer already owns its session/terminal lock through
 -- assert_session. A funding operation affects only its bound terminal shift.
 if v_intent.shift_id is not null then
  if not (select st.cash_controls_enabled from private.system_settings st where st.singleton) then raise exception 'CASH_CONTROLS_DISABLED'; end if;
  select sh.* into v_shift from private.cash_shifts sh where sh.id=v_intent.shift_id for update;
  if not found or v_shift.closed_at is not null or v_shift.terminal_id<>v_session.terminal_id then raise exception 'CASH_SHIFT_REQUIRED'; end if;
  if v_shift.opened_by<>v_session.auth_user_id and v_session.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
  select v_shift.opening_float_won+coalesce(sum(e.amount_won),0) into v_expected from private.cash_shift_events e where e.shift_id=v_shift.id;
  if v_expected+v_intent.cash_delta_won<0 then raise exception 'CASH_INSUFFICIENT'; end if;
 end if;
 if v_intent.wallet_delta_won<>0 then
  if v_intent.state<>'SCANNED' or v_intent.card_id is null or p_student_pin_proof is null or p_student_pin_proof !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
  select c.* into v_credential from private.student_credentials c where c.student_id=v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from private.students s where s.id=v_intent.student_id and s.active for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  perform 1 from private.student_cards c where c.id=v_intent.card_id and c.student_id=v_intent.student_id and c.active for share;
  if not found then raise exception 'FORBIDDEN'; end if;
  if v_credential.locked_until>clock_timestamp() then
   return query select jsonb_build_object('outcome','REJECTED','error_code','RATE_LIMITED'); return;
  end if;
  if not private.verify_pin_proof(p_student_pin_proof,v_credential.pin_hash) then
   update private.student_credentials set failed_attempts=failed_attempts+1,
    locked_until=case when failed_attempts+1>=3 then clock_timestamp()+interval '5 minutes' else null end where student_id=v_intent.student_id;
   update private.funding_intents set pin_attempts=least(3,pin_attempts+1),state=case when pin_attempts+1>=3 then 'CLOSED' else state end where request_key=p_key;
   return query select jsonb_build_object('outcome','REJECTED','error_code','INVALID_PIN'); return;
  end if;
  select w.* into v_wallet from private.wallets w where w.student_id=v_intent.student_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  v_before:=v_wallet.balance_won; v_after:=v_before+v_intent.wallet_delta_won;
  if v_after<(select st.negative_wallet_limit_won from private.system_settings st where st.singleton) then raise exception 'WALLET_LIMIT'; end if;
  if v_after>9007199254740991 then raise exception 'BAD_REQUEST'; end if;
  update private.student_credentials set failed_attempts=0,locked_until=null where student_id=v_intent.student_id;
 end if;
 v_id:=gen_random_uuid(); v_now:=clock_timestamp();
 v_reference:='FND-'||to_char(v_now at time zone 'Asia/Seoul','YYYYMMDD')||'-'||lpad(nextval('private.adjustment_sequence')::text,6,'0');
 if v_intent.wallet_delta_won<>0 then
  v_ledger:=gen_random_uuid();
  insert into private.wallet_ledger(id,reference_number,student_id,amount_won,entry_type,reason_code,balance_before_won,balance_after_won,
   staff_user_id,staff_session_id,source_type,source_id,idempotency_key,notes,created_at)
  values(v_ledger,v_reference,v_intent.student_id,v_intent.wallet_delta_won,
   case when v_intent.action='REVERSE_FUNDING' then 'FUNDING_REVERSAL' when v_intent.wallet_delta_won>0 then 'FUNDS_ADDED' else 'CONTROLLED_DEDUCTION' end,
   v_intent.action,v_before,v_after,v_session.auth_user_id,v_session.id,'FUNDING_OPERATION',v_id,p_key,v_intent.notes,v_now);
  update private.wallets set balance_won=v_after,updated_at=v_now where student_id=v_intent.student_id;
 end if;
 insert into private.funding_operations(id,request_key,reference_number,action,actor_id,staff_session_id,terminal_id,shift_id,student_id,
  wallet_delta_won,cash_delta_won,cash_received_won,change_won,ledger_id,balance_before_won,balance_after_won,approved_by,original_id,source_reference,notes,created_at)
 values(v_id,p_key,v_reference,v_intent.action,v_session.auth_user_id,v_session.id,v_session.terminal_id,v_intent.shift_id,v_intent.student_id,
  v_intent.wallet_delta_won,v_intent.cash_delta_won,v_intent.cash_received_won,v_intent.change_won,v_ledger,v_before,v_after,v_approver.auth_user_id,
  v_intent.original_id,v_intent.source_reference,v_intent.notes,v_now);
 if v_intent.cash_delta_won<>0 then
  insert into private.cash_shift_events(shift_id,source_type,source_id,amount_won,created_at) values(v_intent.shift_id,'FUNDING_OPERATION',v_id,v_intent.cash_delta_won,v_now);
 end if;
 update private.funding_intents set state='COMPLETED' where request_key=p_key;
 insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('FUNDING_RECORDED',v_session.auth_user_id,v_session.id,'FUNDING_OPERATION',v_id,'AUD-'||v_reference,
  jsonb_build_object('action',v_intent.action,'wallet_delta_won',v_intent.wallet_delta_won,'cash_delta_won',v_intent.cash_delta_won,'approved_by',v_approver.auth_user_id));
 return query select jsonb_build_object('outcome','COMPLETED','receipt',private.funding_receipt_document(v_id));
end $$;
create function api.recover_funding(p_session_id uuid,p_key uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_intent private.funding_intents; v_operation private.funding_operations; v_closure private.funding_closures;
begin
 v_session:=private.funding_session(p_session_id);
 if p_key is null then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('funding:'||p_key::text,0));
 select i.* into v_intent from private.funding_intents i where i.request_key=p_key for update;
 if found and (v_intent.actor_id<>v_session.auth_user_id or v_intent.terminal_id<>v_session.terminal_id) then raise exception 'FORBIDDEN'; end if;
 if v_intent.wallet_delta_won<>0 and v_session.role_snapshot not in ('accountant','super_admin') then raise exception 'FORBIDDEN'; end if;
 select o.* into v_operation from private.funding_operations o where o.request_key=p_key;
 if found then return query select jsonb_build_object('outcome','COMPLETED','receipt',private.funding_receipt_document(v_operation.id)); return; end if;
 select c.* into v_closure from private.funding_closures c where c.request_key=p_key;
 if found and (v_closure.actor_id<>v_session.auth_user_id or v_closure.terminal_id<>v_session.terminal_id) then raise exception 'FORBIDDEN'; end if;
 insert into private.funding_closures(request_key,actor_id,terminal_id) values(p_key,v_session.auth_user_id,v_session.terminal_id) on conflict do nothing;
 update private.funding_intents set state='CLOSED' where request_key=p_key;
 return query select jsonb_build_object('outcome','CLOSED');
end $$;
revoke all on function private.funding_session(uuid),private.funding_intent_document(uuid),private.funding_receipt_document(uuid) from public,campuspay_runtime;
revoke all on function api.prepare_funding(uuid,uuid,text,jsonb),api.scan_funding_card(uuid,uuid,text),api.confirm_funding(uuid,uuid,text,text,text,boolean),api.recover_funding(uuid,uuid) from public;
grant execute on function api.prepare_funding(uuid,uuid,text,jsonb),api.scan_funding_card(uuid,uuid,text),api.confirm_funding(uuid,uuid,text,text,text,boolean),api.recover_funding(uuid,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260921091000_funding_api') on conflict do nothing;
