-- Independent of product-photo module 051. No historical migration or flags change.
-- Issuance and physical handover remain separate capabilities and journal actors.
create function private.cash_refund_gate(s private.staff_sessions, issuing boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare sh private.cash_shifts;
begin
 perform 1 from private.system_settings where singleton for share;
 if not (select cash_controls_enabled from private.system_settings where singleton) then
  if issuing and not exists(select 1 from public.staff_profiles p where private.has_capability(p.auth_user_id,'refunds.cash_payout')) then
   return 'PAYOUT_OPERATOR_REQUIRED';
  end if;
  return 'READY';
 end if;
 select * into sh from private.cash_shifts where terminal_id=s.terminal_id and closed_at is null for update;
 if not found then return 'CASH_SHIFT_REQUIRED'; end if;
 if issuing then
  if not private.has_capability(sh.opened_by,'refunds.cash_payout') and not
   (private.has_capability(s.auth_user_id,'refunds.cash_payout') and private.has_capability(s.auth_user_id,'cash.drawer.override')) then
   return 'PAYOUT_OPERATOR_REQUIRED';
  end if;
 elsif sh.opened_by<>s.auth_user_id and not private.has_capability(s.auth_user_id,'cash.drawer.override') then
  return 'DRAWER_OWNER_REQUIRED';
 end if;
 return 'READY';
end $$;

create function api.refund_cash_readiness(p_session_id uuid,p_refund_id uuid,p_sale_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; r private.sale_refunds; state text; amount bigint; issuing boolean;
begin
 s:=private.assert_session(p_session_id,'refunds.read');
 if (p_refund_id is null)=(p_sale_id is null) then raise exception 'BAD_REQUEST'; end if;
 issuing:=p_refund_id is null;
 if issuing then
  if not exists(select 1 from private.sales where id=p_sale_id) then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(settled_amount_won),0) into amount from private.sale_tenders where sale_id=p_sale_id and tender_type='CASH';
  state:=case when not private.has_capability(s.auth_user_id,'refunds.issue') then 'ISSUE_PERMISSION_REQUIRED'
   when amount=0 then 'NO_CASH_DUE' else private.cash_refund_gate(s,true) end;
 else
  select * into r from private.sale_refunds where id=p_refund_id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select coalesce(sum(amount_won),0) into amount from private.refund_tenders where refund_id=r.id and tender_type='CASH';
  state:=case when exists(select 1 from private.cash_refund_payouts where refund_id=r.id) then 'PAID'
   when amount=0 then 'NO_CASH_DUE'
   when not private.has_capability(s.auth_user_id,'refunds.cash_payout') then 'PAYOUT_PERMISSION_REQUIRED'
   when r.terminal_id<>s.terminal_id then 'WRONG_TERMINAL' else private.cash_refund_gate(s,false) end;
 end if;
 return query select jsonb_build_object('state',state,'sale_id',coalesce(p_sale_id,r.sale_id),'refund_id',p_refund_id,
  'terminal_id',s.terminal_id,'handoff',case when issuing then not private.has_capability(s.auth_user_id,'refunds.cash_payout') else r.staff_user_id<>s.auth_user_id end);
end $$;

-- Guard the actual computed CASH leg, including partial refunds and rounding to zero.
-- Runs before any transaction can commit; an unavailable payer rolls back all legs.
create function private.guard_cash_refund_issue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s private.staff_sessions; status text;
begin
 if new.tender_type<>'CASH' or new.amount_won=0 then return new; end if;
 s:=private.assert_session((select staff_session_id from private.sale_refunds where id=new.refund_id),'refunds.issue');
 status:=private.cash_refund_gate(s,true);
 if status<>'READY' then raise exception 'CASH_PAYOUT_UNAVAILABLE'; end if;
 return new;
end $$;
create trigger cash_refund_issue_ready before insert on private.refund_tenders
 for each row execute function private.guard_cash_refund_issue();

-- Preserve the posting engine, payload proof and replay behavior; change only
-- handover ownership policy and enforce drawer custody at the locked cash boundary.
do $$ declare d text; anchor text; begin
 d:=pg_get_functiondef('api.record_refund_cash_payout(uuid,uuid,uuid,bigint,text,boolean)'::regprocedure);
 anchor:='if r.staff_user_id<>ss.auth_user_id or r.terminal_id<>ss.terminal_id then raise exception ''FORBIDDEN''; end if;';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PAYOUT_PATCH_PRECONDITION'; end if;
 execute replace(d,anchor,'if r.terminal_id<>ss.terminal_id then raise exception ''FORBIDDEN''; end if;');
 d:=pg_get_functiondef('private.capture_cash_shift_event()'::regprocedure);
 anchor:='if not found then raise exception ''CASH_SHIFT_REQUIRED''; end if;';
 if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'DRAWER_PATCH_PRECONDITION'; end if;
 execute replace(d,anchor,anchor||E'\n if kind=''REFUND_PAYOUT'' then if sh.opened_by<>new.staff_user_id and not private.has_capability(new.staff_user_id,''cash.drawer.override'') then raise exception ''FORBIDDEN''; end if; end if;');
end $$;
-- Financial equality stays unchanged. A payout now reconciles to its own
-- authenticated operator/session, rather than incorrectly equating issuer/payer.
do $$ declare signature text; d text; anchor text:='p.staff_user_id<>r.staff_user_id'; begin
 foreach signature in array array['private.assert_refund_integrity()','private.assert_partial_refund_integrity(uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'PAYOUT_INTEGRITY_PATCH_PRECONDITION'; end if;
  execute replace(d,anchor,'not exists(select 1 from private.staff_sessions ps where ps.id=p.staff_session_id and ps.auth_user_id=p.staff_user_id and ps.terminal_id=p.terminal_id)');
 end loop;
end $$;
revoke all on function private.cash_refund_gate(private.staff_sessions,boolean),private.guard_cash_refund_issue() from public,campuspay_runtime;
revoke all on function api.refund_cash_readiness(uuid,uuid,uuid) from public;
grant execute on function api.refund_cash_readiness(uuid,uuid,uuid) to campuspay_runtime;

-- A trusted-ingress HMAC is supplied only by the server, never by request JSON.
-- One in-flight verification per bucket and 30 attempts/minute, including unknown
-- accounts. No raw IP is stored. Expired buckets can be pruned by an owner job.
create table private.staff_login_limits (
 ingress_fingerprint text primary key check(ingress_fingerprint ~ '^[a-f0-9]{64}$'),
 window_started_at timestamptz not null, attempts integer not null check(attempts between 1 and 30)
);
revoke all on private.staff_login_limits from public,campuspay_runtime;

create function api.create_staff_session(p_employee_code text,p_pin_proof text,p_session_token_hash text,p_terminal_fingerprint text,p_ingress_fingerprint text)
returns table(session_id uuid,user_id uuid,employee_code text,display_name text,role public.staff_role,permissions text[],expires_at timestamptz,preset text,access_revision bigint)
language plpgsql security definer set search_path = '' as $$
declare p public.staff_profiles; c private.staff_credentials; current_c private.staff_credentials;
 t private.terminals; s private.staff_sessions; a private.staff_access; v_now timestamptz; verified boolean; attempts integer;
begin
 if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9_-]{2,32}$'
  or p_pin_proof is null or p_pin_proof !~ '^[a-f0-9]{64}$'
  or p_session_token_hash is null or p_session_token_hash !~ '^[a-f0-9]{64}$'
  or p_terminal_fingerprint is null or p_terminal_fingerprint !~ '^[a-f0-9]{64}$'
  or p_ingress_fingerprint is null or p_ingress_fingerprint !~ '^[a-f0-9]{64}$' then return; end if;
 if not pg_try_advisory_xact_lock(hashtextextended(p_ingress_fingerprint,40521)) then return; end if;
 v_now:=clock_timestamp();
 insert into private.staff_login_limits values(p_ingress_fingerprint,v_now,1)
 on conflict(ingress_fingerprint) do update set
  attempts=case when staff_login_limits.window_started_at<=v_now-interval '1 minute' then 1 else staff_login_limits.attempts+1 end,
  window_started_at=case when staff_login_limits.window_started_at<=v_now-interval '1 minute' then v_now else staff_login_limits.window_started_at end
 where staff_login_limits.window_started_at<=v_now-interval '1 minute' or staff_login_limits.attempts<30
 returning staff_login_limits.attempts into attempts;
 if attempts is null then return; end if;
 select * into p from public.staff_profiles where lower(public.staff_profiles.employee_code)=lower(p_employee_code) and active;
 select * into c from private.staff_credentials where staff_user_id=p.auth_user_id;
 -- Snapshot verification holds NO staff/session/credential/terminal/global lock.
 verified:=private.verify_pin_proof(p_pin_proof,c.pin_hash);
 if c.locked_until>clock_timestamp() then return; end if;
 if p.auth_user_id is null or c.staff_user_id is null then return; end if;
 if not verified then
  begin
   select * into current_c from private.staff_credentials where staff_user_id=p.auth_user_id for update nowait;
   if current_c.pin_hash is distinct from c.pin_hash or current_c.locked_until>clock_timestamp() then return; end if;
   update private.staff_credentials set failed_attempts=failed_attempts+1,
    locked_until=case when failed_attempts+1>=5 then clock_timestamp()+interval '5 minutes' else null end where staff_user_id=p.auth_user_id;
  exception when lock_not_available then return; end;
  return;
 end if;
 -- Finalize briefly under the existing lifecycle order, but NEVER wait behind it.
 -- Snapshot/hash, active status, role, terminal and access are revalidated here.
 if not pg_try_advisory_xact_lock(hashtextextended('campuspay-staff-administration',0)) then return; end if;
 begin
  perform 1 from private.staff_sessions ss where ss.terminal_id=(select id from private.terminals where terminal_fingerprint=p_terminal_fingerprint)
   and ss.revoked_at is null order by ss.id for update nowait;
  select * into current_c from private.staff_credentials where staff_user_id=p.auth_user_id for update nowait;
  if current_c.pin_hash is distinct from c.pin_hash or current_c.locked_until>clock_timestamp() then return; end if;
  select * into p from public.staff_profiles where auth_user_id=c.staff_user_id and active;
  if not found then return; end if;
  select * into a from private.staff_access where private.staff_access.user_id=p.auth_user_id;
  if not found then return; end if;
  select * into t from private.terminals where terminal_fingerprint=p_terminal_fingerprint for update nowait;
  if found and not t.active then return; end if;
  if t.id is null then insert into private.terminals(terminal_fingerprint) values(p_terminal_fingerprint) returning * into t; end if;
  v_now:=clock_timestamp();
  update private.staff_credentials set failed_attempts=0,locked_until=null where staff_user_id=p.auth_user_id;
  update private.terminals set last_seen_at=v_now where id=t.id;
  update private.staff_sessions set revoked_at=v_now where terminal_id=t.id and revoked_at is null;
  insert into private.staff_sessions(auth_user_id,employee_code_snapshot,role_snapshot,terminal_id,session_token_hash,access_revision,expires_at)
   values(p.auth_user_id,p.employee_code,p.role,t.id,p_session_token_hash,a.revision,v_now+private.session_timeout(p.role)) returning * into s;
  return query select s.id,p.auth_user_id,p.employee_code,p.display_name,p.role,a.permissions,s.expires_at,a.preset,a.revision;
 exception when lock_not_available then return; end;
end $$;
revoke all on function api.create_staff_session(text,text,text,text,text) from public;
grant execute on function api.create_staff_session(text,text,text,text,text) to campuspay_runtime;
-- Fail closed for old app servers. They cannot bypass ingress admission or use
-- the old globally serialized bcrypt path. Owner-only historical rehearsals remain.
revoke all on function api.create_staff_session(text,text,text,text) from public,campuspay_runtime;
