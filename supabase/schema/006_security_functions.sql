create or replace function api.create_elevation(
  p_session_id uuid,
  p_approver_user_id uuid,
  p_purpose text,
  p_student_id uuid,
  p_token_hash text
)
returns table(expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_approver public.staff_profiles;
  v_expiry timestamptz := now() + interval '60 seconds';
begin
  v_session := private.assert_session(p_session_id, 'security.credentials.request');
  if p_purpose not in ('RESET_STUDENT_PIN','RESET_STUDENT_CARD') or length(p_token_hash) <> 64 then raise exception 'BAD_REQUEST'; end if;
  if not exists(select 1 from private.students where id = p_student_id and active) then raise exception 'NOT_FOUND'; end if;

  select * into v_approver from public.staff_profiles
  where auth_user_id = p_approver_user_id and active and role = 'super_admin';
  if not found then raise exception 'FORBIDDEN'; end if;

  insert into private.elevation_tokens(
    token_hash, requested_by, approved_by, staff_session_id, purpose, student_id, expires_at
  ) values (
    p_token_hash, v_session.auth_user_id, p_approver_user_id, v_session.id, p_purpose, p_student_id, v_expiry
  );

  insert into private.audit_events(event_type, actor_user_id, approver_user_id, staff_session_id,
    subject_type, subject_id, reference_number, safe_payload)
  values ('CREDENTIAL_RESET_AUTHORIZED', v_session.auth_user_id, p_approver_user_id, v_session.id,
    'STUDENT', p_student_id, 'AUD-ELEV-' || substr(gen_random_uuid()::text,1,8), jsonb_build_object('purpose', p_purpose));

  return query select v_expiry;
end;
$$;

create or replace function private.consume_elevation(
  p_session private.staff_sessions,
  p_token_hash text,
  p_purpose text,
  p_student_id uuid
)
returns private.elevation_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token private.elevation_tokens;
begin
  select * into v_token from private.elevation_tokens
  where token_hash = p_token_hash
    and staff_session_id = p_session.id
    and requested_by = p_session.auth_user_id
    and purpose = p_purpose
    and student_id = p_student_id
    and consumed_at is null
    and expires_at > now()
  for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  update private.elevation_tokens set consumed_at = now() where id = v_token.id returning * into v_token;
  return v_token;
end;
$$;

create or replace function api.reset_student_pin(
  p_session_id uuid,
  p_student_id uuid,
  p_elevation_token_hash text,
  p_new_pin_proof text
)
returns table(audit_reference text, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_elevation private.elevation_tokens;
  v_reference text := 'AUD-PIN-' || substr(gen_random_uuid()::text,1,8);
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'security.credentials.request');
  if p_new_pin_proof !~ '^[a-f0-9]{64}$' then raise exception 'BAD_REQUEST'; end if;
  v_elevation := private.consume_elevation(v_session, p_elevation_token_hash, 'RESET_STUDENT_PIN', p_student_id);

  update private.student_credentials
  set pin_hash = extensions.crypt(p_new_pin_proof, extensions.gen_salt('bf', 12)),
      failed_attempts = 0, locked_until = null, pin_updated_at = v_now
  where student_id = p_student_id;
  if not found then raise exception 'NOT_FOUND'; end if;

  insert into private.audit_events(event_type, actor_user_id, approver_user_id, staff_session_id,
    subject_type, subject_id, reference_number, safe_payload)
  values ('STUDENT_PIN_RESET', v_session.auth_user_id, v_elevation.approved_by, v_session.id,
    'STUDENT', p_student_id, v_reference, '{}'::jsonb);
  return query select v_reference, v_now;
end;
$$;

create or replace function api.reset_student_card(
  p_session_id uuid,
  p_student_id uuid,
  p_elevation_token_hash text,
  p_new_card_fingerprint text
)
returns table(audit_reference text, completed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session private.staff_sessions;
  v_elevation private.elevation_tokens;
  v_reference text := 'AUD-CARD-' || substr(gen_random_uuid()::text,1,8);
  v_now timestamptz := now();
begin
  v_session := private.assert_session(p_session_id, 'security.credentials.request');
  if length(p_new_card_fingerprint) <> 64 then raise exception 'BAD_REQUEST'; end if;
  v_elevation := private.consume_elevation(v_session, p_elevation_token_hash, 'RESET_STUDENT_CARD', p_student_id);

  update private.student_cards set active = false, deactivated_at = v_now
  where student_id = p_student_id and active;
  insert into private.student_cards(student_id, card_fingerprint, active, issued_by)
  values (p_student_id, p_new_card_fingerprint, true, v_session.auth_user_id);

  insert into private.audit_events(event_type, actor_user_id, approver_user_id, staff_session_id,
    subject_type, subject_id, reference_number, safe_payload)
  values ('STUDENT_CARD_RESET', v_session.auth_user_id, v_elevation.approved_by, v_session.id,
    'STUDENT', p_student_id, v_reference, '{}'::jsonb);
  return query select v_reference, v_now;
end;
$$;
