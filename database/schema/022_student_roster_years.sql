-- Roster membership is independent of card/PIN issuance. No personal data is seeded here.
alter table private.students add column year_group smallint;
alter table private.students add column academic_year text;
alter table private.students add constraint students_year_group_check check (year_group between 1 and 13);
alter table private.students add constraint students_academic_year_check check (
  academic_year is null or (
    academic_year ~ '^[0-9]{4}-[0-9]{4}$'
    and substring(academic_year,6,4)::integer = substring(academic_year,1,4)::integer + 1
  )
);
create index students_year_directory_idx on private.students(year_group,display_name,student_code);
comment on column private.students.year_group is 'School Year label, independent of immutable student_code; NULL means not confirmed.';
comment on column private.students.academic_year is 'Year-group assignment validity, e.g. 2026-2027. Never infer from a historical grade label.';

create or replace function api.search_students_v2(
  p_session_id uuid, p_query text default '', p_year_group integer default null, p_offset integer default 0
)
returns table(student_id uuid, student_code text, display_name text, active boolean,
  balance_won bigint, card_active boolean, pin_locked_until timestamptz, created_at timestamptz,
  audit_reference text, year_group smallint, academic_year text, pin_set boolean, total_count bigint)
language plpgsql security definer set search_path = '' as $$
declare v_session private.staff_sessions;
begin
  v_session := private.assert_session(p_session_id, 'students.manage');
  if v_session.role_snapshot <> 'super_admin' then raise exception 'FORBIDDEN'; end if;
  if length(coalesce(p_query, '')) > 120 or p_offset is null or p_offset < 0 or p_offset > 1000000
    or (p_year_group is not null and p_year_group not between 1 and 13)
  then raise exception 'BAD_REQUEST'; end if;
  return query select s.id, s.student_code, s.display_name, s.active, w.balance_won,
    exists(select 1 from private.student_cards c where c.student_id=s.id and c.active),
    case when cr.locked_until>now() then cr.locked_until else null end,
    s.created_at, e.audit_reference, s.year_group, s.academic_year,
    cr.student_id is not null, count(*) over()
  from private.students s
  join private.wallets w on w.student_id=s.id
  left join private.student_credentials cr on cr.student_id=s.id
  left join private.student_enrollments e on e.student_id=s.id
  where (p_year_group is null or s.year_group=p_year_group)
    and (coalesce(btrim(p_query),'')='' or s.id::text=p_query
      or strpos(lower(s.student_code),lower(btrim(p_query)))>0
      or strpos(lower(s.display_name),lower(btrim(p_query)))>0)
  order by s.year_group nulls last, s.display_name, s.student_code
  limit 50 offset p_offset;
end;
$$;
revoke all on function api.search_students_v2(uuid,text,integer,integer) from public;
grant execute on function api.search_students_v2(uuid,text,integer,integer) to campuspay_runtime;
insert into private.schema_migrations(version) values ('20260918110000_student_roster_years') on conflict do nothing;
