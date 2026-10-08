-- No wallet change during readiness, preparation or scanning. Expected identity is
-- bound server-side and checked before the original card/PIN/ledger posting logic.
alter table private.funding_intents add column expected_student_id uuid references private.students(id) on delete restrict;
create function api.student_funding_readiness(p_session_id uuid,p_student_id uuid) returns table(result jsonb)
language plpgsql security definer set search_path = '' as $$ declare s private.staff_sessions;begin
 s:=private.assert_session(p_session_id,'wallet.fund');
 return query select jsonb_build_object('database_enabled',st.funding_enabled,'cash_enabled',st.cash_controls_enabled,
 'drawer_open',exists(select 1 from private.cash_shifts sh where sh.terminal_id=s.terminal_id and sh.closed_at is null),
 'drawer_assigned',exists(select 1 from private.cash_shifts sh where sh.terminal_id=s.terminal_id and sh.closed_at is null
 and (sh.opened_by=s.auth_user_id or private.has_capability(s.auth_user_id,'cash.drawer.override'))),
 'student_active',student.active,'card_ready',exists(select 1 from private.student_cards c where c.student_id=student.id and c.active),
 'pin_ready',exists(select 1 from private.student_credentials c where c.student_id=student.id),
 'pin_locked',exists(select 1 from private.student_credentials c where c.student_id=student.id and c.locked_until>clock_timestamp()))
 from private.students student cross join private.system_settings st where student.id=p_student_id and st.singleton;
end $$;
create function api.prepare_student_funding(p_session_id uuid,p_student_id uuid,p_key uuid,p_payload jsonb)
returns table(result jsonb) language plpgsql security definer set search_path = '' as $$ declare response jsonb;i private.funding_intents;begin
 perform private.assert_session(p_session_id,'wallet.fund');
 if p_student_id is null or not exists(select 1 from private.students st where st.id=p_student_id and st.active
 and exists(select 1 from private.student_cards c where c.student_id=st.id and c.active)
 and exists(select 1 from private.student_credentials c where c.student_id=st.id)) then raise exception 'STUDENT_CREDENTIALS_REQUIRED';end if;
 select x.result into response from api.prepare_funding(p_session_id,p_key,'CASH_DEPOSIT',p_payload) x;
 select * into i from private.funding_intents where request_key=p_key for update;
 if i.expected_student_id is not null and i.expected_student_id<>p_student_id then raise exception 'CONFLICT';end if;
 if i.student_id is not null and i.student_id<>p_student_id then raise exception 'CONFLICT';end if;
 update private.funding_intents set expected_student_id=p_student_id where request_key=p_key and expected_student_id is null;
 return query select response;
end $$;
do $$ declare d text;a text:='if (v_intent.student_id is not null and v_intent.student_id<>v_card.student_id) or (v_intent.card_id is not null and v_intent.card_id<>v_card.id) then raise exception ''CONFLICT''; end if;';begin
 d:=pg_get_functiondef('api.scan_funding_card(uuid,uuid,text)'::regprocedure);
 if position(a in d)=0 then raise exception 'STUDENT_FUNDING_BINDING_PRECONDITION';end if;
 execute replace(d,a,a||E'
 if v_intent.expected_student_id is not null and v_intent.expected_student_id<>v_card.student_id then raise exception ''CONFLICT'';end if;');
end $$;
revoke all on function api.student_funding_readiness(uuid,uuid),api.prepare_student_funding(uuid,uuid,uuid,jsonb) from public;
grant execute on function api.student_funding_readiness(uuid,uuid),api.prepare_student_funding(uuid,uuid,uuid,jsonb) to campuspay_runtime;

insert into private.schema_migrations(version) values('20261005094000_contextual_student_funding') on conflict do nothing;
