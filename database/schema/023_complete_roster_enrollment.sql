-- Initial issuance to an existing roster identity. This migration issues no credentials.
-- Completed receipts use the existing immutable enrollment journal; closures fence late requests.
create table private.student_completion_closures (
  idempotency_key uuid primary key,
  student_id uuid not null references private.students(id) on delete restrict,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  created_at timestamptz not null default now()
);
create trigger immutable_student_completion_closures before update or delete on private.student_completion_closures
for each row execute function private.reject_journal_mutation();
revoke all on private.student_completion_closures from public, campuspay_runtime;

create or replace function api.complete_student_enrollment(
  p_session_id uuid, p_student_id uuid, p_expected_code text, p_expected_name text,
  p_expected_year integer, p_expected_academic_year text, p_identity_verified boolean,
  p_card_fingerprint text, p_pin_proof text, p_idempotency_key uuid
)
returns table(outcome text, student_id uuid, audit_reference text, completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions;
  v_student private.students;
  v_existing private.student_enrollments;
  v_closed private.student_completion_closures;
  v_limit private.student_enrollment_limits;
  v_proof text;
  v_reference text := 'AUD-COMPLETE-' || gen_random_uuid()::text;
  v_constraint text;
  v_completed timestamptz;
begin
  v_session := private.assert_session(p_session_id, 'students.manage');
  if v_session.role_snapshot <> 'super_admin' then raise exception 'FORBIDDEN'; end if;
  if p_student_id is null or p_idempotency_key is null or p_identity_verified is distinct from true
    or p_expected_code is null or p_expected_code !~ '^[A-Za-z0-9_-]{1,40}$'
    or p_expected_name is null or length(p_expected_name) not between 1 and 120 or p_expected_name ~ '[[:cntrl:]]'
    or (p_expected_year is not null and p_expected_year not between 1 and 13)
    or (p_expected_academic_year is not null and p_expected_academic_year !~ '^[0-9]{4}-[0-9]{4}$')
    or p_card_fingerprint is null or p_card_fingerprint !~ '^[a-f0-9]{64}$'
    or p_pin_proof is null or p_pin_proof !~ '^[a-f0-9]{64}$'
  then raise exception 'BAD_REQUEST'; end if;

  -- Share the original enrollment key namespace, including across staff sessions.
  perform pg_advisory_xact_lock(hashtextextended('student-enrollment:' || p_idempotency_key::text, 0));
  v_proof := encode(extensions.digest(jsonb_build_array('ROSTER_COMPLETION_V1', p_student_id,
    p_expected_code, p_expected_name, p_expected_year, p_expected_academic_year,
    p_card_fingerprint, p_pin_proof)::text, 'sha256'), 'hex');
  select e.* into v_existing from private.student_enrollments e where e.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.staff_user_id<>v_session.auth_user_id or v_existing.student_id<>p_student_id or v_existing.request_proof<>v_proof then
      return query select 'IDEMPOTENCY_CONFLICT'::text, null::uuid, null::text, null::timestamptz;
    else
      return query select 'COMPLETED'::text, v_existing.student_id, v_existing.audit_reference, v_existing.created_at;
    end if;
    return;
  end if;
  select c.* into v_closed from private.student_completion_closures c where c.idempotency_key=p_idempotency_key;
  if found then
    return query select case when v_closed.staff_user_id=v_session.auth_user_id and v_closed.student_id=p_student_id
      then 'CLOSED' else 'IDEMPOTENCY_CONFLICT' end, null::uuid, null::text, null::timestamptz;
    return;
  end if;

  insert into private.student_enrollment_limits(staff_user_id) values(v_session.auth_user_id)
  on conflict (staff_user_id) do nothing;
  select l.* into v_limit from private.student_enrollment_limits l where l.staff_user_id=v_session.auth_user_id for update;
  if v_limit.window_started_at<=now()-interval '1 minute' then
    update private.student_enrollment_limits set window_started_at=now(),attempt_count=0 where staff_user_id=v_session.auth_user_id;
    v_limit.attempt_count:=0;
  end if;
  if v_limit.attempt_count>=30 then
    return query select 'RATE_LIMITED'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  update private.student_enrollment_limits set attempt_count=attempt_count+1 where staff_user_id=v_session.auth_user_id;

  -- Different request keys for one student serialize here. No student or wallet is replaced.
  select s.* into v_student from private.students s where s.id=p_student_id for update;
  if not found then
    return query select 'NOT_FOUND'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  if not v_student.active then
    return query select 'INACTIVE'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  if v_student.student_code is distinct from p_expected_code or v_student.display_name is distinct from p_expected_name
    or v_student.year_group is distinct from p_expected_year or v_student.academic_year is distinct from p_expected_academic_year then
    return query select 'STUDENT_CHANGED'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  if exists(select 1 from private.student_credentials c where c.student_id=p_student_id)
    or exists(select 1 from private.student_cards c where c.student_id=p_student_id)
    or exists(select 1 from private.student_enrollments e where e.student_id=p_student_id) then
    return query select 'ALREADY_ISSUED'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  if not exists(select 1 from private.wallets w where w.student_id=p_student_id) then raise exception 'BAD_REQUEST'; end if;
  if exists(select 1 from private.student_cards c where c.card_fingerprint=p_card_fingerprint) then
    return query select 'CARD_ASSIGNED'::text,null::uuid,null::text,null::timestamptz; return;
  end if;

  begin
    insert into private.student_credentials(student_id,pin_hash)
      values(p_student_id,extensions.crypt(p_pin_proof,extensions.gen_salt('bf',12)));
    insert into private.student_cards(student_id,card_fingerprint,issued_by)
      values(p_student_id,p_card_fingerprint,v_session.auth_user_id);
    insert into private.audit_events(event_type,actor_user_id,staff_session_id,subject_type,subject_id,reference_number,safe_payload)
      values('STUDENT_ENROLLMENT_COMPLETED',v_session.auth_user_id,v_session.id,'STUDENT',p_student_id,v_reference,
        jsonb_build_object('existing_roster_identity',true,'identity_verified',true,'wallet_changed',false,'year_group',v_student.year_group));
    insert into private.student_enrollments(idempotency_key,student_id,staff_user_id,request_proof,audit_reference)
      values(p_idempotency_key,p_student_id,v_session.auth_user_id,v_proof,v_reference) returning created_at into v_completed;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='student_cards_card_fingerprint_key' then outcome:='CARD_ASSIGNED';
    elsif v_constraint in ('student_credentials_pkey','student_enrollments_student_id_key') then outcome:='ALREADY_ISSUED';
    else raise; end if;
    student_id:=null; audit_reference:=null; completed_at:=null;
    return next; return;
  end;
  return query select 'COMPLETED'::text,p_student_id,v_reference,v_completed;
end;
$$;

create or replace function api.recover_student_completion(p_session_id uuid,p_student_id uuid,p_idempotency_key uuid)
returns table(outcome text,student_id uuid,audit_reference text,completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions;
  v_existing private.student_enrollments;
  v_closed private.student_completion_closures;
begin
  v_session:=private.assert_session(p_session_id,'students.manage');
  if v_session.role_snapshot<>'super_admin' then raise exception 'FORBIDDEN'; end if;
  if p_student_id is null or p_idempotency_key is null then raise exception 'BAD_REQUEST'; end if;
  perform pg_advisory_xact_lock(hashtextextended('student-enrollment:' || p_idempotency_key::text,0));
  select e.* into v_existing from private.student_enrollments e where e.idempotency_key=p_idempotency_key;
  if found then
    if v_existing.student_id<>p_student_id or v_existing.staff_user_id<>v_session.auth_user_id then
      return query select 'IDEMPOTENCY_CONFLICT'::text,null::uuid,null::text,null::timestamptz;
    else
      return query select 'COMPLETED'::text,v_existing.student_id,v_existing.audit_reference,v_existing.created_at;
    end if;
    return;
  end if;
  select c.* into v_closed from private.student_completion_closures c where c.idempotency_key=p_idempotency_key;
  if found then
    return query select case when v_closed.student_id=p_student_id and v_closed.staff_user_id=v_session.auth_user_id
      then 'CLOSED' else 'IDEMPOTENCY_CONFLICT' end,null::uuid,null::text,null::timestamptz;
    return;
  end if;
  if not exists(select 1 from private.students s where s.id=p_student_id) then
    return query select 'NOT_FOUND'::text,null::uuid,null::text,null::timestamptz; return;
  end if;
  -- A missing committed receipt closes the request; a late original request cannot issue afterward.
  insert into private.student_completion_closures(idempotency_key,student_id,staff_user_id)
    values(p_idempotency_key,p_student_id,v_session.auth_user_id);
  return query select 'CLOSED'::text,null::uuid,null::text,null::timestamptz;
end;
$$;
revoke all on function api.complete_student_enrollment(uuid,uuid,text,text,integer,text,boolean,text,text,uuid),
  api.recover_student_completion(uuid,uuid,uuid) from public;
grant execute on function api.complete_student_enrollment(uuid,uuid,text,text,integer,text,boolean,text,text,uuid),
  api.recover_student_completion(uuid,uuid,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values('20260918130000_complete_roster_enrollment') on conflict do nothing;
