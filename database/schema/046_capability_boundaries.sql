-- Forward-only, counted edits preserve transaction bodies, idempotency, journals and locks.
create function pg_temp.replace_access_boundary(signature text,anchor text,replacement text,expected integer) returns void
language plpgsql set search_path = '' as $$ declare definition text; n integer; begin
 definition:=pg_get_functiondef(signature::regprocedure);
 n:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
 if n<>expected then raise exception 'ACCESS_BOUNDARY_PRECONDITION: % expected %, found %',signature,expected,n;end if;
 execute replace(definition,anchor,replacement);
end $$;
create or replace function private.cash_session(p_session_id uuid) returns private.staff_sessions
language plpgsql security definer set search_path = '' as $$ begin
 return private.assert_session(p_session_id,'cash.read');end $$;
create or replace function private.funding_session(p_session_id uuid) returns private.staff_sessions
language plpgsql security definer set search_path = '' as $$ begin
 return private.assert_session_any(p_session_id,array['wallet.read','wallet.fund','wallet.correct','wallet.reverse','cash.movement.record']);end $$;
create function private.funding_capability(p_action text) returns text
language sql immutable set search_path = '' as $$ select case p_action
 when 'CASH_DEPOSIT' then 'wallet.fund' when 'NONCASH_CREDIT' then 'wallet.correct'
 when 'ADMIN_DEBIT' then 'wallet.correct' when 'REVERSE_FUNDING' then 'wallet.reverse'
 when 'PAID_IN' then 'cash.movement.record' when 'PAID_OUT' then 'cash.movement.record'
 when 'CASH_DROP' then 'cash.movement.record' else 'access.invalid' end; $$;
revoke all on function private.funding_capability(text) from public,campuspay_runtime;

select pg_temp.replace_access_boundary('api.search_students(uuid,text)','''students.manage''','''students.read''',1);

select pg_temp.replace_access_boundary('api.search_students(uuid,text)','if v_session.role_snapshot <> ''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Authorization is effective-capability based.',1);

select pg_temp.replace_access_boundary('api.search_students(uuid,text)','w.balance_won,','case when private.has_capability(v_session.auth_user_id,''wallet.read'') then w.balance_won else null::bigint end,',1);

select pg_temp.replace_access_boundary('api.search_students_v2(uuid,text,integer,integer)','''students.manage''','''students.read''',1);

select pg_temp.replace_access_boundary('api.search_students_v2(uuid,text,integer,integer)','if v_session.role_snapshot <> ''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Authorization is effective-capability based.',1);

select pg_temp.replace_access_boundary('api.search_students_v2(uuid,text,integer,integer)','w.balance_won,','case when private.has_capability(v_session.auth_user_id,''wallet.read'') then w.balance_won else null::bigint end,',1);

select pg_temp.replace_access_boundary('api.enroll_student(uuid,text,text,text,text,uuid)','''students.manage''','''students.enroll''',1);

select pg_temp.replace_access_boundary('api.enroll_student(uuid,text,text,text,text,uuid)','if v_session.role_snapshot <> ''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Authorization is effective-capability based.',1);

select pg_temp.replace_access_boundary('api.complete_student_enrollment(uuid,uuid,text,text,integer,text,boolean,text,text,uuid)','''students.manage''','''students.enroll''',1);

select pg_temp.replace_access_boundary('private.complete_student_enrollment_legacy(uuid,uuid,text,text,integer,text,boolean,text,text,uuid)','''students.manage''','''students.enroll''',1);

select pg_temp.replace_access_boundary('private.complete_student_enrollment_legacy(uuid,uuid,text,text,integer,text,boolean,text,text,uuid)','if v_session.role_snapshot <> ''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Authorization is effective-capability based.',1);

select pg_temp.replace_access_boundary('api.recover_student_completion(uuid,uuid,uuid)','''students.manage''','''students.enroll''',1);

select pg_temp.replace_access_boundary('api.recover_student_completion(uuid,uuid,uuid)','if v_session.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Explicit enrollment access required.',1);

select pg_temp.replace_access_boundary('api.refund_sale_detail(uuid,text)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('api.refund_day_summary(uuid,date,date)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('api.preview_partial_refund(uuid,uuid,jsonb)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('api.quote_partial_refund(uuid,uuid,jsonb)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('api.refund_record(uuid,uuid)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('api.partial_refund_snapshot(uuid,text,integer)','''reports.sales''','''refunds.read''',1);

select pg_temp.replace_access_boundary('private.post_sale_reversal(uuid,uuid,text,text,jsonb,boolean,uuid,text)','''reports.sales''','''refunds.issue''',1);

select pg_temp.replace_access_boundary('private.post_sale_reversal(uuid,uuid,text,text,jsonb,boolean,uuid,text)','if ss.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Explicit refund issue capability; integrity and installed gates remain.',1);

select pg_temp.replace_access_boundary('api.post_partial_refund(uuid,uuid,uuid,jsonb,integer,text,text,boolean,text)','''reports.sales''','''refunds.issue''',1);

select pg_temp.replace_access_boundary('api.post_partial_refund(uuid,uuid,uuid,jsonb,integer,text,text,boolean,text)','if ss.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Explicit refund issue capability; integrity and installed gates remain.',1);

select pg_temp.replace_access_boundary('api.recover_sale_refund(uuid,uuid,uuid)','''reports.sales''','''refunds.issue''',1);

select pg_temp.replace_access_boundary('api.recover_sale_refund(uuid,uuid,uuid)','if ss.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Explicit refund issue capability; integrity and installed gates remain.',1);

select pg_temp.replace_access_boundary('api.record_refund_cash_payout(uuid,uuid,uuid,bigint,text,boolean)','''reports.sales''','''refunds.cash_payout''',1);

select pg_temp.replace_access_boundary('api.record_refund_cash_payout(uuid,uuid,uuid,bigint,text,boolean)','if ss.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Exact authorized cash handover capability.',1);

select pg_temp.replace_access_boundary('api.daily_reconciliation(uuid,date)','''reports.sales''','''reconciliation.read''',1);

select pg_temp.replace_access_boundary('api.staff_online_orders(uuid)','''orders.fulfill''','''orders.read''',1);

select pg_temp.replace_access_boundary('api.list_coupons(uuid)','''coupons.manage''','''coupons.read''',1);

select pg_temp.replace_access_boundary('api.list_coupons_v2(uuid)','''coupons.manage''','''coupons.read''',1);

select pg_temp.replace_access_boundary('api.create_payment_intent(uuid,jsonb,uuid,text,text,bigint)','private.role_has_permission(v_session.role_snapshot, ''coupons.redeem'')','private.has_capability(v_session.auth_user_id, ''coupons.redeem'')',1);

select pg_temp.replace_access_boundary('api.terminal_payment_policy_v2(uuid)','s:=private.assert_session(p_session_id,''pos.read'');','s:=private.assert_session_any(p_session_id,array[''pos.read'',''settings.payments.manage'']);',1);

select pg_temp.replace_access_boundary('api.terminal_payment_policy_v2(uuid)','s.role_snapshot=''super_admin''::public.staff_role','private.has_capability(s.auth_user_id,''settings.payments.manage'')',1);

select pg_temp.replace_access_boundary('api.set_terminal_payment_policy(uuid,boolean,text,timestamptz)','''security.staff.manage''','''settings.payments.manage''',1);

select pg_temp.replace_access_boundary('api.set_terminal_payment_policy(uuid,boolean,text,timestamptz)','if s.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Payment settings have their own explicit capability.',1);

select pg_temp.replace_access_boundary('api.cash_register_snapshot(uuid,integer)','s.role_snapshot in (''super_admin'',''accountant'')','private.has_capability(s.auth_user_id,''cash.history.all'')',2);

select pg_temp.replace_access_boundary('api.cash_history_page(uuid,date,date,text,integer,boolean)','v_session.role_snapshot in (''accountant'',''super_admin'')','private.has_capability(v_session.auth_user_id,''cash.history.all'')',2);

select pg_temp.replace_access_boundary('api.open_cash_shift(uuid,uuid,jsonb,boolean)','if s.role_snapshot=''accountant'' and not (select funding_enabled from private.system_settings where singleton) then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,''cash.shift.manage'');
 if not private.has_capability(s.auth_user_id,''pos.checkout'') and not (select funding_enabled from private.system_settings where singleton) then raise exception ''FUNDING_DISABLED''; end if;',1);

select pg_temp.replace_access_boundary('api.close_cash_shift(uuid,uuid,uuid,jsonb,text,boolean)','if s.role_snapshot=''accountant'' and not (select funding_required from private.system_settings where singleton) then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,''cash.shift.manage'');
 if not private.has_capability(s.auth_user_id,''pos.checkout'') and not (select funding_required from private.system_settings where singleton) then raise exception ''FUNDING_DISABLED''; end if;',1);

select pg_temp.replace_access_boundary('api.close_cash_shift(uuid,uuid,uuid,jsonb,text,boolean)','s.role_snapshot<>''super_admin''','not private.has_capability(s.auth_user_id,''cash.drawer.override'')',1);

select pg_temp.replace_access_boundary('api.recover_cash_operation(uuid,uuid,text,uuid)','if s.role_snapshot=''accountant'' and not (select funding_required from private.system_settings where singleton) then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,''cash.shift.manage'');
 if not private.has_capability(s.auth_user_id,''pos.checkout'') and not (select funding_required from private.system_settings where singleton) then raise exception ''FUNDING_DISABLED''; end if;',1);

select pg_temp.replace_access_boundary('api.recover_cash_operation(uuid,uuid,text,uuid)','s.role_snapshot=''super_admin''','private.has_capability(s.auth_user_id,''cash.drawer.override'')',1);

select pg_temp.replace_access_boundary('api.approve_cash_variance(uuid,uuid,text)','''reports.sales''','''cash.variance.review''',1);

select pg_temp.replace_access_boundary('api.approve_cash_variance(uuid,uuid,text)','if s.role_snapshot not in (''accountant'',''super_admin'') then raise exception ''FORBIDDEN''; end if;','-- Independent reviewer capability required.',1);

select pg_temp.replace_access_boundary('api.prepare_funding(uuid,uuid,text,jsonb)','if p_action in (''CASH_DEPOSIT'',''NONCASH_CREDIT'',''ADMIN_DEBIT'',''REVERSE_FUNDING'') and v_session.role_snapshot not in (''accountant'',''super_admin'') then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,private.funding_capability(p_action));',1);

select pg_temp.replace_access_boundary('api.scan_funding_card(uuid,uuid,text)','v_session:=private.assert_session(p_session_id,''wallet.adjust'');','v_session:=private.funding_session(p_session_id);',1);

select pg_temp.replace_access_boundary('api.scan_funding_card(uuid,uuid,text)','if v_intent.wallet_delta_won=0 or','perform private.assert_session(p_session_id,private.funding_capability(v_intent.action));
 if v_intent.wallet_delta_won=0 or',1);

select pg_temp.replace_access_boundary('private.confirm_funding_legacy(uuid,uuid,text,text,text,boolean)','if v_intent.wallet_delta_won<>0 and v_session.role_snapshot not in (''accountant'',''super_admin'') then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,private.funding_capability(v_intent.action));',1);

select pg_temp.replace_access_boundary('api.recover_funding(uuid,uuid)','if v_intent.wallet_delta_won<>0 and v_session.role_snapshot not in (''accountant'',''super_admin'') then raise exception ''FORBIDDEN''; end if;','perform private.assert_session(p_session_id,private.funding_capability(v_intent.action));',1);

select pg_temp.replace_access_boundary('api.prepare_funding(uuid,uuid,text,jsonb)','v_session.role_snapshot<>''super_admin''','not private.has_capability(v_session.auth_user_id,''cash.drawer.override'')',1);

select pg_temp.replace_access_boundary('private.confirm_funding_legacy(uuid,uuid,text,text,text,boolean)','v_session.role_snapshot<>''super_admin''','not private.has_capability(v_session.auth_user_id,''cash.drawer.override'')',1);

select pg_temp.replace_access_boundary('private.confirm_funding_legacy(uuid,uuid,text,text,text,boolean)','(v_intent.wallet_delta_won<>0 and v_approver.role<>''super_admin'') or
   (v_intent.wallet_delta_won=0 and v_approver.role not in (''accountant'',''super_admin''))','not private.has_capability(v_approver.auth_user_id,case when v_intent.wallet_delta_won<>0 then ''wallet.approve'' else ''cash.movement.approve'' end)',1);

select pg_temp.replace_access_boundary('api.funding_history(uuid,date,date,integer)','v_session.role_snapshot in (''accountant'',''super_admin'')','private.has_capability(v_session.auth_user_id,''wallet.read'')',1);

select pg_temp.replace_access_boundary('api.export_funding(uuid,date,date)','v_session.role_snapshot in (''accountant'',''super_admin'')','private.has_capability(v_session.auth_user_id,''wallet.read'')',1);

select pg_temp.replace_access_boundary('api.recover_wallet_adjustment(uuid,uuid)','''wallet.adjust''','''wallet.read''',1);

select pg_temp.replace_access_boundary('api.search_security_students(uuid,text)','''security.credentials.request''','''credentials.read''',1);

select pg_temp.replace_access_boundary('api.create_elevation(uuid,text,text,text,uuid,text)','''security.credentials.request''','''credentials.read''',1);

select pg_temp.replace_access_boundary('api.create_elevation(uuid,text,text,text,uuid,text)','v_approver := private.verify_staff_pin(p_approver_employee_code, p_approver_pin_proof, ''super_admin'');','perform private.assert_session(p_session_id,case p_purpose when ''RESET_STUDENT_PIN'' then ''credentials.reset'' else ''credentials.card.replace'' end);
  v_approver := private.verify_staff_pin(p_approver_employee_code, p_approver_pin_proof, null);',1);

select pg_temp.replace_access_boundary('api.create_elevation(uuid,text,text,text,uuid,text)','if v_approver.auth_user_id is null then return; end if;','if v_approver.auth_user_id is null then return; end if;
  if v_approver.auth_user_id=v_session.auth_user_id or not private.has_capability(v_approver.auth_user_id,''credentials.approve'') then raise exception ''FORBIDDEN''; end if;',1);

select pg_temp.replace_access_boundary('private.consume_elevation(private.staff_sessions,text,text,uuid)','if not found then raise exception ''FORBIDDEN''; end if;','if not found or v_token.approved_by=p_session.auth_user_id or not private.has_capability(v_token.approved_by,''credentials.approve'') then raise exception ''FORBIDDEN''; end if;',1);

select pg_temp.replace_access_boundary('api.reset_student_pin(uuid,uuid,text,text)','''security.credentials.request''','''credentials.reset''',1);

select pg_temp.replace_access_boundary('api.reset_student_card(uuid,uuid,text,text)','''security.credentials.request''','''credentials.card.replace''',1);

select pg_temp.replace_access_boundary('api.record_directory(uuid,text,text,text,integer,uuid)','''students.manage''','''students.read''',1);

select pg_temp.replace_access_boundary('api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text)','''students.manage''','''students.status.manage''',1);

select pg_temp.replace_access_boundary('api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text)','if p_kind=''STUDENT'' and s.role_snapshot<>''super_admin'' then raise exception ''FORBIDDEN''; end if;','-- Student lifecycle has its own capability and still requires fresh actor PIN.',1);

select pg_temp.replace_access_boundary('api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text)','private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,''super_admin'')','private.verify_staff_pin(s.employee_code_snapshot,p_admin_pin_proof,null)',1);

select pg_temp.replace_access_boundary('api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text)','private.role_has_permission(s.role_snapshot,''inventory.price.manage'')','private.has_capability(s.auth_user_id,''inventory.price.manage'')',1);

select pg_temp.replace_access_boundary('api.recover_record_operation(uuid,uuid,text)','''students.manage''','''students.status.manage''',1);

select pg_temp.replace_access_boundary('api.change_record(uuid,uuid,text,text,uuid,jsonb,text,text)','case when p_kind=''PRODUCT'' then ''inventory.product.manage'' else ''students.status.manage'' end','case when p_kind=''STUDENT'' then ''students.status.manage'' when p_action=''CHANGE_PRODUCT_PRICE'' then ''inventory.price.manage'' else ''inventory.product.manage'' end',1);

select pg_temp.replace_access_boundary('api.recover_record_operation(uuid,uuid,text)','s:=private.assert_session(p_session_id,case when p_kind=''PRODUCT'' then ''inventory.product.manage'' else ''students.status.manage'' end);','s:=private.assert_session_any(p_session_id,case when p_kind=''PRODUCT'' then array[''inventory.product.manage'',''inventory.price.manage''] else array[''students.status.manage''] end);',1);

insert into private.schema_migrations(version) values('20261005091000_capability_boundaries') on conflict do nothing;
