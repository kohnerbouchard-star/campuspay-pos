-- October audit remediation. Additive migration; historical migrations remain unchanged.
-- No feature activation, credential issuance, wallet edits, or live fixture repair.

create or replace function api.reset_student_pin(
  p_session_id uuid, p_student_id uuid, p_elevation_token_hash text, p_new_pin_proof text
)
returns table(audit_reference text, completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions;
  v_elevation private.elevation_tokens;
  v_reference text := 'AUD-PIN-' || substr(gen_random_uuid()::text,1,8);
  v_now timestamptz := now();
  v_existing boolean;
begin
  v_session := private.assert_session(p_session_id, 'security.credentials.request');
  if p_new_pin_proof is null or p_new_pin_proof !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
  -- Same lock order as enrollment/card operations: the existing student first.
  perform 1 from private.students where id=p_student_id and active for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select exists(select 1 from private.student_credentials where student_id=p_student_id) into v_existing;
  if not v_existing and not exists(select 1 from private.student_cards where student_id=p_student_id and active) then
    raise exception 'CONFLICT: complete enrollment before issuing an initial PIN';
  end if;
  v_elevation := private.consume_elevation(v_session, p_elevation_token_hash, 'RESET_STUDENT_PIN', p_student_id);
  insert into private.student_credentials(student_id,pin_hash,failed_attempts,locked_until,pin_updated_at)
  values(p_student_id,extensions.crypt(p_new_pin_proof,extensions.gen_salt('bf',12)),0,null,v_now)
  on conflict(student_id) do update set pin_hash=excluded.pin_hash,
    failed_attempts=0,locked_until=null,pin_updated_at=excluded.pin_updated_at;
  update private.customer_sessions set revoked_at=v_now where student_id=p_student_id and revoked_at is null;
  insert into private.audit_events(event_type,actor_user_id,approver_user_id,staff_session_id,
    subject_type,subject_id,reference_number,safe_payload)
  values(case when v_existing then 'STUDENT_PIN_RESET' else 'STUDENT_PIN_INITIALIZED' end,
    v_session.auth_user_id,v_elevation.approved_by,v_session.id,'STUDENT',p_student_id,v_reference,'{}'::jsonb);
  return query select v_reference,v_now;
end;
$$;

-- Preserve the established costing/lot allocation implementation behind the
-- strengthened idempotency boundary. It is never executable by the runtime.
alter function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) set schema private;
alter function private.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) rename to remove_stock_costed;
revoke all on function private.remove_stock_costed(uuid,uuid,uuid,integer,text,text,uuid) from public,campuspay_runtime;
create table private.stock_adjustment_closures(
  idempotency_key uuid primary key,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id),
  terminal_id uuid not null references private.terminals(id),
  closed_at timestamptz not null default now()
);
revoke all on private.stock_adjustment_closures from public,campuspay_runtime;

create or replace function api.remove_stock(
  p_session_id uuid,p_product_id uuid,p_lot_id uuid,p_quantity integer,
  p_reason_code text,p_notes text,p_idempotency_key uuid
)
returns table(reference_id uuid,reference_number text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_existing private.stock_adjustments;
begin
  v_session := private.assert_session(p_session_id,'inventory.adjust');
  if p_idempotency_key is null or p_product_id is null or p_quantity is null or p_quantity<1
    or p_reason_code is null or p_reason_code not in ('DAMAGED','EXPIRED','SUPPLIER_RETURN','STOCK_COUNT_LOSS')
    or p_notes is null or length(trim(p_notes)) not between 3 and 500 then raise exception 'BAD_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,40602));
  if exists(select 1 from private.stock_adjustment_closures where idempotency_key=p_idempotency_key) then
    raise exception 'CONFLICT: request closed without posting';
  end if;
  select * into v_existing from private.stock_adjustments where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.adjusted_by is distinct from v_session.auth_user_id or not exists(
      select 1 from private.staff_sessions s where s.id=v_existing.staff_session_id and s.terminal_id=v_session.terminal_id
    ) then raise exception 'FORBIDDEN'; end if;
    if v_existing.product_id is distinct from p_product_id or v_existing.requested_lot_id is distinct from p_lot_id
      or v_existing.quantity_removed is distinct from p_quantity or v_existing.reason_code is distinct from p_reason_code
      or v_existing.notes is distinct from trim(p_notes) then raise exception 'CONFLICT: replay payload changed'; end if;
    return query select v_existing.id,v_existing.reference_number,v_existing.created_at;
    return;
  end if;
  return query select * from private.remove_stock_costed(p_session_id,p_product_id,p_lot_id,p_quantity,p_reason_code,trim(p_notes),p_idempotency_key);
end;
$$;

create or replace function api.recover_stock_adjustment(p_session_id uuid,p_idempotency_key uuid)
returns table(reference_id uuid,reference_number text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions; v_existing private.stock_adjustments;
  v_closed private.stock_adjustment_closures;
begin
  v_session := private.assert_session(p_session_id,'inventory.adjust');
  if p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key::text,40602));
  select * into v_existing from private.stock_adjustments where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.adjusted_by is distinct from v_session.auth_user_id or not exists(
      select 1 from private.staff_sessions s where s.id=v_existing.staff_session_id and s.terminal_id=v_session.terminal_id
    ) then raise exception 'FORBIDDEN'; end if;
    return query select v_existing.id,v_existing.reference_number,v_existing.created_at;
    return;
  end if;
  select * into v_closed from private.stock_adjustment_closures where idempotency_key=p_idempotency_key;
  if found then
    if v_closed.staff_user_id is distinct from v_session.auth_user_id or v_closed.terminal_id is distinct from v_session.terminal_id then
      raise exception 'FORBIDDEN';
    end if;
    return;
  end if;
  insert into private.stock_adjustment_closures(idempotency_key,staff_user_id,terminal_id)
    values(p_idempotency_key,v_session.auth_user_id,v_session.terminal_id);
  insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
    values('STOCK_REMOVAL_REQUEST_CLOSED',v_session.auth_user_id,v_session.id,'STOCK_ADJUSTMENT_REQUEST',p_idempotency_key,
      'AUD-ADJ-CLOSE-'||p_idempotency_key::text,'{}'::jsonb);
end;
$$;

create or replace function api.installation_readiness(p_session_id uuid)
returns table(readiness jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id,'security.staff.manage');
  return query select jsonb_build_object(
    'features',jsonb_build_object('refunds',s.refunds_enabled,'returns',s.returns_enabled,
      'cash_controls',s.cash_controls_enabled,'administration',s.administration_enabled,
      'partial_refund_preview',s.partial_refund_preview_enabled,'partial_refunds',s.partial_refunds_enabled,'funding',s.funding_enabled),
    'active_card_missing_pin',(select count(*) from private.students st where st.active
      and exists(select 1 from private.student_cards c where c.student_id=st.id and c.active)
      and not exists(select 1 from private.student_credentials c where c.student_id=st.id)),
    'receipt_cost_mismatches',(select count(*) from private.stock_receipts r
      where r.total_landed_cost_won is distinct from (select coalesce(sum(l.total_landed_cost_won),0) from private.stock_receipt_lines l where l.receipt_id=r.id))
  ) from private.system_settings s where singleton;
end;
$$;
revoke all on function api.reset_student_pin(uuid,uuid,text,text) from public;
revoke all on function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) from public;
revoke all on function api.recover_stock_adjustment(uuid,uuid) from public;
revoke all on function api.installation_readiness(uuid) from public;
grant execute on function api.reset_student_pin(uuid,uuid,text,text) to campuspay_runtime;
grant execute on function api.remove_stock(uuid,uuid,uuid,integer,text,text,uuid) to campuspay_runtime;
grant execute on function api.recover_stock_adjustment(uuid,uuid) to campuspay_runtime;
grant execute on function api.installation_readiness(uuid) to campuspay_runtime;
