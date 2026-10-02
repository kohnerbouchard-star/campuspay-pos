-- Credential lifecycle repair. No student, wallet, PIN or card is changed by migration.
-- Ordinary reset/replacement cannot silently perform first issuance.
create function private.student_credential_state(p_student_id uuid) returns text
language sql stable security definer set search_path = '' as $$
 select case when not s.active then 'INACTIVE'
  when c.pin_set and c.card_active then 'READY'
  when not c.pin_set and c.card_active then 'CARD_ONLY'
  when c.pin_set and c.card_history then 'CARD_REQUIRED'
  when not c.pin_set and not c.card_history then 'ROSTER_ONLY'
  else 'INCOMPLETE' end
 from private.students s cross join lateral (select
  exists(select 1 from private.student_credentials p where p.student_id=s.id) pin_set,
  exists(select 1 from private.student_cards a where a.student_id=s.id and a.active) card_active,
  exists(select 1 from private.student_cards a where a.student_id=s.id) card_history) c
 where s.id=p_student_id;
$$;

create function private.assert_credential_action(p_student_id uuid,p_purpose text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_state text;
begin
 perform 1 from private.students s where s.id=p_student_id for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 v_state:=private.student_credential_state(p_student_id);
 if v_state='INACTIVE' then raise exception 'FORBIDDEN'; end if;
 if p_purpose='COMPLETE_STUDENT_PIN' then
  if v_state<>'CARD_ONLY' then raise exception 'CONFLICT'; end if;
 elsif p_purpose in ('RESET_STUDENT_PIN','RESET_STUDENT_CARD') then
  if v_state='ROSTER_ONLY' then raise exception 'ENROLLMENT_REQUIRED'; end if;
  if v_state not in ('READY','CARD_REQUIRED') then raise exception 'INCOMPLETE_ENROLLMENT'; end if;
 else raise exception 'BAD_REQUEST'; end if;
end;
$$;
revoke all on function private.student_credential_state(uuid),private.assert_credential_action(uuid,text) from public,campuspay_runtime;

alter table private.elevation_tokens drop constraint elevation_tokens_purpose_check;
alter table private.elevation_tokens add constraint elevation_tokens_purpose_check
 check(purpose in ('RESET_STUDENT_PIN','RESET_STUDENT_CARD','COMPLETE_STUDENT_PIN'));

create or replace function api.create_elevation(
 p_session_id uuid,p_approver_employee_code text,p_approver_pin_proof text,p_purpose text,p_student_id uuid,p_token_hash text
) returns table(expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_approver public.staff_profiles; v_expiry timestamptz:=now()+interval '60 seconds';
begin
 v_session:=private.assert_session(p_session_id,'security.credentials.request');
 if p_purpose is null or p_purpose not in ('RESET_STUDENT_PIN','RESET_STUDENT_CARD','COMPLETE_STUDENT_PIN')
  or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
 if p_purpose='COMPLETE_STUDENT_PIN' and v_session.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 perform private.assert_credential_action(p_student_id,p_purpose);
 v_approver:=private.verify_staff_pin(p_approver_employee_code,p_approver_pin_proof,'super_admin');
 -- A denied PIN must commit the existing lockout counters, not roll them back.
 if v_approver.auth_user_id is null then return; end if;
 insert into private.elevation_tokens(token_hash,requested_by,approved_by,staff_session_id,purpose,student_id,expires_at)
 values(p_token_hash,v_session.auth_user_id,v_approver.auth_user_id,v_session.id,p_purpose,p_student_id,v_expiry);
 insert into private.audit_events(event_type,actor_user_id,approver_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('CREDENTIAL_RESET_AUTHORIZED',v_session.auth_user_id,v_approver.auth_user_id,v_session.id,'STUDENT',p_student_id,
  'AUD-ELEV-'||gen_random_uuid()::text,jsonb_build_object('purpose',p_purpose));
 return query select v_expiry;
end;
$$;

create or replace function api.reset_student_pin(p_session_id uuid,p_student_id uuid,p_elevation_token_hash text,p_new_pin_proof text)
returns table(audit_reference text,completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_elevation private.elevation_tokens;
 v_reference text:='AUD-PIN-'||gen_random_uuid()::text; v_now timestamptz:=now();
begin
 v_session:=private.assert_session(p_session_id,'security.credentials.request');
 if p_new_pin_proof is null or p_new_pin_proof !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
 perform private.assert_credential_action(p_student_id,'RESET_STUDENT_PIN');
 v_elevation:=private.consume_elevation(v_session,p_elevation_token_hash,'RESET_STUDENT_PIN',p_student_id);
 update private.student_credentials set pin_hash=extensions.crypt(p_new_pin_proof,extensions.gen_salt('bf',12)),
  failed_attempts=0,locked_until=null,pin_updated_at=v_now where student_id=p_student_id;
 if not found then raise exception 'INCOMPLETE_ENROLLMENT'; end if;
 insert into private.audit_events(event_type,actor_user_id,approver_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('STUDENT_PIN_RESET',v_session.auth_user_id,v_elevation.approved_by,v_session.id,'STUDENT',p_student_id,v_reference,'{}'::jsonb);
 return query select v_reference,v_now;
end;
$$;

create or replace function api.reset_student_card(p_session_id uuid,p_student_id uuid,p_elevation_token_hash text,p_new_card_fingerprint text)
returns table(audit_reference text,completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_elevation private.elevation_tokens;
 v_reference text:='AUD-CARD-'||gen_random_uuid()::text; v_now timestamptz:=now();
begin
 v_session:=private.assert_session(p_session_id,'security.credentials.request');
 if p_new_card_fingerprint is null or p_new_card_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
 perform private.assert_credential_action(p_student_id,'RESET_STUDENT_CARD');
 v_elevation:=private.consume_elevation(v_session,p_elevation_token_hash,'RESET_STUDENT_CARD',p_student_id);
 update private.student_cards set active=false,deactivated_at=v_now where student_id=p_student_id and active;
 insert into private.student_cards(student_id,card_fingerprint,active,issued_by)
 values(p_student_id,p_new_card_fingerprint,true,v_session.auth_user_id);
 insert into private.audit_events(event_type,actor_user_id,approver_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('STUDENT_CARD_RESET',v_session.auth_user_id,v_elevation.approved_by,v_session.id,'STUDENT',p_student_id,v_reference,'{}'::jsonb);
 return query select v_reference,v_now;
end;
$$;

create function api.complete_missing_student_pin(
 p_session_id uuid,p_student_id uuid,p_elevation_token_hash text,p_new_pin_proof text,p_identity_verified boolean
) returns table(audit_reference text,completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions; v_elevation private.elevation_tokens;
 v_reference text:='AUD-CREDENTIAL-REPAIR-'||gen_random_uuid()::text; v_now timestamptz:=now();
begin
 v_session:=private.assert_session(p_session_id,'students.manage');
 if v_session.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
 if p_identity_verified is distinct from true or p_new_pin_proof is null or p_new_pin_proof !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
 perform private.assert_credential_action(p_student_id,'COMPLETE_STUDENT_PIN');
 v_elevation:=private.consume_elevation(v_session,p_elevation_token_hash,'COMPLETE_STUDENT_PIN',p_student_id);
 -- No UPSERT: ordinary PIN resets remain separate, and concurrent repairs cannot replace a PIN.
 insert into private.student_credentials(student_id,pin_hash,pin_updated_at)
 values(p_student_id,extensions.crypt(p_new_pin_proof,extensions.gen_salt('bf',12)),v_now);
 insert into private.audit_events(event_type,actor_user_id,approver_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
 values('INCOMPLETE_ENROLLMENT_REPAIRED',v_session.auth_user_id,v_elevation.approved_by,v_session.id,'STUDENT',p_student_id,
  v_reference,jsonb_build_object('previous_state','CARD_ONLY','identity_verified',true,'wallet_preserved',true,'card_preserved',true));
 return query select v_reference,v_now;
end;
$$;

create function api.search_security_students_v2(p_session_id uuid,p_query text default '')
returns table(student_id uuid,student_code text,display_name text,card_active boolean,pin_set boolean,credential_state text)
language plpgsql security definer set search_path = '' as $$
begin
 perform private.assert_session(p_session_id,'security.credentials.request');
 if length(coalesce(p_query,''))>120 then raise exception 'BAD_REQUEST'; end if;
 return query select s.id,s.student_code,s.display_name,
  exists(select 1 from private.student_cards c where c.student_id=s.id and c.active),
  exists(select 1 from private.student_credentials c where c.student_id=s.id),private.student_credential_state(s.id)
 from private.students s where s.active and (coalesce(btrim(p_query),'')='' or s.id::text=p_query
  or strpos(lower(s.student_code),lower(btrim(p_query)))>0 or strpos(lower(s.display_name),lower(btrim(p_query)))>0)
 order by s.display_name,s.student_code,s.id limit 50;
end;
$$;
revoke all on function api.complete_missing_student_pin(uuid,uuid,text,text,boolean),api.search_security_students_v2(uuid,text) from public;
grant execute on function api.complete_missing_student_pin(uuid,uuid,text,text,boolean),api.search_security_students_v2(uuid,text) to campuspay_runtime;
insert into private.schema_migrations(version) values('20261002040000_student_credential_lifecycle') on conflict do nothing;
