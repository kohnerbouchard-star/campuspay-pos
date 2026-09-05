-- Complete the migration without resetting existing ledgers or student balances.
do $finish$
declare d text;
begin
  d := pg_get_functiondef('private.verify_staff_pin(text,text,public.staff_role)'::regprocedure);
  d := replace(d, 'raise exception ''UNAUTHENTICATED'';', 'return null;');
  d := replace(d, 'raise exception ''RATE_LIMITED'';', 'return null;');
  d := replace(d, 'extensions.crypt(p_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash',
                  'extensions.crypt(p_pin_proof, v_credential.pin_hash) is distinct from v_credential.pin_hash');
  execute d;
  d := pg_get_functiondef('api.create_staff_session(text,text,text,text)'::regprocedure);
  d := replace(d, 'v_profile := private.verify_staff_pin(p_employee_code, p_pin_proof, null);',
    'v_profile := private.verify_staff_pin(p_employee_code, p_pin_proof, null); if v_profile.auth_user_id is null then return; end if;');
  d := replace(d, 'if p_session_token_hash !~', 'if p_session_token_hash is null or p_terminal_fingerprint is null or p_session_token_hash !~');
  execute d;
  d := pg_get_functiondef('api.create_elevation(uuid,text,text,text,uuid,text)'::regprocedure);
  d := replace(d, 'v_approver := private.verify_staff_pin(p_approver_employee_code, p_approver_pin_proof, ''super_admin'');',
    'v_approver := private.verify_staff_pin(p_approver_employee_code, p_approver_pin_proof, ''super_admin''); if v_approver.auth_user_id is null then return; end if;');
  execute d;
  d := pg_get_functiondef('private.price_cart(jsonb,boolean)'::regprocedure);
  d := replace(d, 'if jsonb_typeof(p_items) <> ''array''', 'if p_items is null or jsonb_typeof(p_items) <> ''array''');
  d := replace(d, 'v_item.product_id is null or v_item.quantity < 1', 'v_item.product_id is null or v_item.quantity is null or v_item.quantity < 1');
  d := replace(d, E'select coalesce(sum(quantity_remaining), 0)::bigint into v_stock\n    from private.inventory_lots\n    where product_id = v_product.id and quantity_remaining > 0;',
    'select coalesce(sum(l.quantity_remaining), 0)::bigint into v_stock from private.inventory_lots l where l.product_id = v_product.id and l.quantity_remaining > 0;');
  execute d;
  d := pg_get_functiondef('api.confirm_payment(uuid,uuid,text)'::regprocedure);
  d := replace(d, 'if extensions.crypt(p_student_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash then',
    'if p_student_pin_proof is null or p_student_pin_proof !~ ''^[a-f0-9]{64}$'' or extensions.crypt(p_student_pin_proof, v_credential.pin_hash) is distinct from v_credential.pin_hash then');
  d := replace(d, 'order by pii.id', 'order by pii.product_id');
  execute d;
  d := pg_get_functiondef('api.confirm_wallet_adjustment(uuid,uuid,text)'::regprocedure);
  d := replace(d, 'if extensions.crypt(p_student_pin_proof, v_credential.pin_hash) <> v_credential.pin_hash then',
    'if p_student_pin_proof is null or p_student_pin_proof !~ ''^[a-f0-9]{64}$'' or extensions.crypt(p_student_pin_proof, v_credential.pin_hash) is distinct from v_credential.pin_hash then');
  execute d;
end;
$finish$;

revoke all on function api.bootstrap_demo(jsonb,text,text,text) from public, campuspay_runtime;
create or replace function private.reject_journal_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Journal entries cannot be changed; post a correcting transaction'; end;
$$;
do $$ declare t text; begin
  foreach t in array array['wallet_ledger','inventory_movements','audit_events','coupon_redemptions','sale_cost_allocations','product_price_history'] loop
    if not exists(select 1 from pg_trigger where tgrelid=('private.'||t)::regclass and tgname='immutable_journal') then
      execute format('create trigger immutable_journal before update or delete on private.%I for each row execute function private.reject_journal_mutation()', t);
    end if;
  end loop;
end; $$;
revoke all on function private.reject_journal_mutation() from public, campuspay_runtime;
insert into private.schema_migrations(version) values ('20260905070000_finish_neon') on conflict do nothing;

-- Align database result contracts with the existing role-specific user interfaces.
-- Keep the prior read contract intact for rollback.
create or replace function api.search_student_wallets_v2(p_session_id uuid,p_query text default '')
returns table(student_id uuid, student_code text, display_name text,balance_won bigint,debt_won bigint,card_active boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id,'wallet.read');
  return query select s.id,s.student_code,s.display_name,w.balance_won,greatest(0::bigint,-w.balance_won),
    exists(select 1 from private.student_cards c where c.student_id=s.id and c.active)
    from private.students s join private.wallets w on w.student_id=s.id
    where s.active and (coalesce(p_query,'')='' or s.student_code ilike '%'||p_query||'%' or s.display_name ilike '%'||p_query||'%')
    order by s.display_name limit 50;
end; $$;
-- Versioned read API; no function or table deletion is needed.
create or replace function api.list_coupons_v2(p_session_id uuid)
returns table(coupon_id uuid,name text,code_masked text,discount_type text,fixed_amount_won bigint,percentage_bps integer,
minimum_subtotal_won bigint,max_discount_won bigint,total_redemption_limit integer,per_student_limit integer,
redemption_count bigint,discount_given_won bigint,starts_at timestamptz,ends_at timestamptz,active boolean,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id,'coupons.manage');
  return query select c.id,c.name,c.code_masked,case when c.discount_type='FIXED_WON' then 'FIXED' else 'PERCENTAGE' end,
    c.fixed_amount_won,c.percentage_bps,c.minimum_subtotal_won,c.max_discount_won,c.total_redemption_limit,c.per_student_limit,
    count(r.id),coalesce(sum(r.discount_won),0)::bigint,c.starts_at,c.ends_at,c.active,c.created_at
    from private.coupons c left join private.coupon_redemptions r on r.coupon_id=c.id
    group by c.id order by c.created_at desc;
end; $$;
revoke all on function api.search_student_wallets_v2(uuid,text),api.list_coupons_v2(uuid) from public;
grant execute on function api.search_student_wallets_v2(uuid,text),api.list_coupons_v2(uuid) to campuspay_runtime;
