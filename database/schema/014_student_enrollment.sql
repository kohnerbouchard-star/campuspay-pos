-- E202 enrollment uses the existing student model and always opens a zero-balance wallet.
-- Funding remains a separate, PIN-authorized and journaled Accounting operation.
create or replace function private.permissions_for_role(p_role public.staff_role)
returns text[] language sql immutable set search_path = '' as $$
  select case p_role
    when 'cashier' then array['pos.read','pos.checkout','coupons.redeem','orders.fulfill']::text[]
    when 'inventory_admin' then array[
      'inventory.read','inventory.receive','inventory.adjust','inventory.product.manage','inventory.price.manage',
      'coupons.manage','reports.inventory','security.credentials.request','orders.fulfill'
    ]::text[]
    when 'accountant' then array[
      'wallet.read','wallet.adjust','reports.sales','reports.inventory','reports.wallets','reports.coupons',
      'security.credentials.request'
    ]::text[]
    when 'super_admin' then array[
      'pos.read','pos.checkout','coupons.redeem','inventory.read','inventory.receive','inventory.adjust',
      'inventory.product.manage','inventory.price.manage','coupons.manage','wallet.read','wallet.adjust',
      'reports.sales','reports.inventory','reports.wallets','reports.coupons','security.credentials.request',
      'security.step_up','security.credentials.reset','security.staff.manage','orders.fulfill','students.manage'
    ]::text[]
  end;
$$;

create table private.student_enrollment_limits (
  staff_user_id uuid primary key references public.staff_profiles(auth_user_id) on delete restrict,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

create table private.student_enrollments (
  idempotency_key uuid primary key,
  student_id uuid not null unique references private.students(id) on delete restrict,
  staff_user_id uuid not null references public.staff_profiles(auth_user_id) on delete restrict,
  request_proof text not null check (request_proof ~ '^[a-f0-9]{64}$'),
  audit_reference text not null unique references private.audit_events(reference_number) on delete restrict,
  created_at timestamptz not null default now()
);
create trigger immutable_student_enrollments before update or delete on private.student_enrollments
for each row execute function private.reject_journal_mutation();

create or replace function api.search_students(p_session_id uuid, p_query text default '')
returns table(student_id uuid, student_code text, display_name text, active boolean,
  balance_won bigint, card_active boolean, pin_locked_until timestamptz, created_at timestamptz,
  audit_reference text)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions;
begin
  v_session := private.assert_session(p_session_id, 'students.manage');
  if v_session.role_snapshot <> 'super_admin' then raise exception 'FORBIDDEN'; end if;
  if length(coalesce(p_query, '')) > 120 then raise exception 'BAD_REQUEST'; end if;
  return query select s.id, s.student_code, s.display_name, s.active, w.balance_won,
    exists(select 1 from private.student_cards c where c.student_id = s.id and c.active),
    case when cr.locked_until > now() then cr.locked_until else null end, s.created_at, e.audit_reference
  from private.students s
  join private.wallets w on w.student_id = s.id
  left join private.student_credentials cr on cr.student_id = s.id
  left join private.student_enrollments e on e.student_id = s.id
  where coalesce(btrim(p_query), '') = '' or s.id::text = p_query
    or strpos(lower(s.student_code), lower(btrim(p_query))) > 0
    or strpos(lower(s.display_name), lower(btrim(p_query))) > 0
  order by s.display_name, s.student_code limit 50;
end;
$$;

-- Credential operators can find a student without receiving wallet access.
create or replace function api.search_security_students(p_session_id uuid, p_query text default '')
returns table(student_id uuid, student_code text, display_name text, card_active boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id, 'security.credentials.request');
  if length(coalesce(p_query, '')) > 120 then raise exception 'BAD_REQUEST'; end if;
  return query select s.id, s.student_code, s.display_name,
    exists(select 1 from private.student_cards c where c.student_id = s.id and c.active)
  from private.students s
  where s.active and (coalesce(btrim(p_query), '') = '' or s.id::text = p_query
    or strpos(lower(s.student_code), lower(btrim(p_query))) > 0
    or strpos(lower(s.display_name), lower(btrim(p_query))) > 0)
  order by s.display_name, s.student_code limit 50;
end;
$$;

create or replace function api.enroll_student(
  p_session_id uuid, p_student_code text, p_display_name text,
  p_card_fingerprint text, p_pin_proof text, p_idempotency_key uuid
)
returns table(outcome text, student_id uuid, student_code text, display_name text,
  balance_won bigint, card_active boolean, created_at timestamptz, audit_reference text)
language plpgsql security definer set search_path = '' as $$
declare
  v_session private.staff_sessions;
  v_limit private.student_enrollment_limits;
  v_existing private.student_enrollments;
  v_student private.students;
  v_proof text;
  v_constraint text;
  v_reference text := 'AUD-ENROLL-' || gen_random_uuid()::text;
begin
  v_session := private.assert_session(p_session_id, 'students.manage');
  if v_session.role_snapshot <> 'super_admin' then raise exception 'FORBIDDEN'; end if;
  if p_student_code is null or btrim(p_student_code) !~ '^[A-Za-z0-9_-]{1,40}$'
    or p_display_name is null or length(btrim(p_display_name)) not between 1 and 120
    or p_display_name ~ '[[:cntrl:]]' or p_idempotency_key is null
    or p_card_fingerprint is null or p_card_fingerprint !~ '^[a-f0-9]{64}$'
    or p_pin_proof is null or p_pin_proof !~ '^[a-f0-9]{64}$'
  then raise exception 'BAD_REQUEST'; end if;

  -- Serialize retries of the same request, including requests from different staff sessions.
  perform pg_advisory_xact_lock(hashtextextended('student-enrollment:' || p_idempotency_key::text, 0));
  v_proof := encode(extensions.digest(jsonb_build_array(btrim(p_student_code), btrim(p_display_name),
    p_card_fingerprint, p_pin_proof)::text, 'sha256'), 'hex');
  select e.* into v_existing from private.student_enrollments e where e.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.staff_user_id <> v_session.auth_user_id or v_existing.request_proof <> v_proof then
      return query select 'IDEMPOTENCY_CONFLICT'::text, null::uuid, null::text, null::text,
        null::bigint, null::boolean, null::timestamptz, null::text;
      return;
    end if;
    select s.* into v_student from private.students s where s.id = v_existing.student_id;
    return query select 'ENROLLED'::text, v_student.id, v_student.student_code, v_student.display_name,
      0::bigint, true, v_existing.created_at, v_existing.audit_reference;
    return;
  end if;

  -- Actor-scoped limit is shared by all terminals and persists rejected duplicate attempts.
  insert into private.student_enrollment_limits(staff_user_id) values (v_session.auth_user_id)
  on conflict (staff_user_id) do nothing;
  select l.* into v_limit from private.student_enrollment_limits l
  where l.staff_user_id = v_session.auth_user_id for update;
  if v_limit.window_started_at <= now() - interval '1 minute' then
    update private.student_enrollment_limits set window_started_at = now(), attempt_count = 0
    where staff_user_id = v_session.auth_user_id;
    v_limit.attempt_count := 0;
  end if;
  if v_limit.attempt_count >= 30 then
    return query select 'RATE_LIMITED'::text, null::uuid, null::text, null::text,
      null::bigint, null::boolean, null::timestamptz, null::text;
    return;
  end if;
  update private.student_enrollment_limits set attempt_count = attempt_count + 1
  where staff_user_id = v_session.auth_user_id;

  -- Normalize duplicate checks without rewriting existing student identifiers.
  perform pg_advisory_xact_lock(hashtextextended('student-code:' || lower(btrim(p_student_code)), 0));
  if exists(select 1 from private.students s where lower(btrim(s.student_code)) = lower(btrim(p_student_code))) then
    return query select 'STUDENT_EXISTS'::text, null::uuid, null::text, null::text,
      null::bigint, null::boolean, null::timestamptz, null::text;
    return;
  end if;
  if exists(select 1 from private.student_cards c where c.card_fingerprint = p_card_fingerprint) then
    return query select 'CARD_ASSIGNED'::text, null::uuid, null::text, null::text,
      null::bigint, null::boolean, null::timestamptz, null::text;
    return;
  end if;

  -- This subtransaction contains every enrollment artifact; any error rolls them all back.
  begin
    insert into private.students(student_code, display_name)
    values (btrim(p_student_code), btrim(p_display_name)) returning * into v_student;
    insert into private.wallets(student_id, balance_won) values (v_student.id, 0);
    insert into private.student_credentials(student_id, pin_hash)
    values (v_student.id, extensions.crypt(p_pin_proof, extensions.gen_salt('bf', 12)));
    insert into private.student_cards(student_id, card_fingerprint, issued_by)
    values (v_student.id, p_card_fingerprint, v_session.auth_user_id);
    insert into private.audit_events(event_type, actor_user_id, staff_session_id,
      subject_type, subject_id, reference_number, safe_payload)
    values ('STUDENT_ENROLLED', v_session.auth_user_id, v_session.id, 'STUDENT', v_student.id,
      v_reference, jsonb_build_object('initial_balance_won', 0, 'card_active', true));
    insert into private.student_enrollments(idempotency_key, student_id, staff_user_id, request_proof, audit_reference)
    values (p_idempotency_key, v_student.id, v_session.auth_user_id, v_proof, v_reference);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'student_cards_card_fingerprint_key' then outcome := 'CARD_ASSIGNED';
    elsif v_constraint = 'students_student_code_key' then outcome := 'STUDENT_EXISTS';
    else raise;
    end if;
    return next;
    return;
  end;
  return query select 'ENROLLED'::text, v_student.id, v_student.student_code, v_student.display_name,
    0::bigint, true, v_student.created_at, v_reference;
end;
$$;

revoke all on private.student_enrollment_limits, private.student_enrollments from public, campuspay_runtime;
revoke all on function private.permissions_for_role(public.staff_role) from public, campuspay_runtime;
revoke all on function api.search_students(uuid,text), api.search_security_students(uuid,text),
  api.enroll_student(uuid,text,text,text,text,uuid) from public;
grant execute on function api.search_students(uuid,text), api.search_security_students(uuid,text),
  api.enroll_student(uuid,text,text,text,text,uuid) to campuspay_runtime;
insert into private.schema_migrations(version) values ('20260907120000_student_enrollment') on conflict do nothing;
