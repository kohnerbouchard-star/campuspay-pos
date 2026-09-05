-- One-time development bootstrap. This function accepts only pre-hashed/HMAC
-- credential proofs and permanently refuses to run after staff credentials exist.
create or replace function api.bootstrap_demo(
  p_staff jsonb,
  p_student_pin_proof text,
  p_card_fingerprint text,
  p_coupon_code_fingerprint text
)
returns table(
  staff_count integer,
  product_count integer,
  student_count integer,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_staff jsonb;
  v_staff_id uuid;
  v_inventory_admin_id uuid;
  v_super_admin_id uuid;
  v_student_id uuid;
  v_terminal_id uuid;
  v_session_id uuid;
  v_receipt_id uuid;
  v_receipt_line_id uuid;
  v_lot_id uuid;
  v_product record;
begin
  lock table public.staff_profiles in access exclusive mode;
  lock table private.staff_credentials in access exclusive mode;

  if exists (select 1 from private.staff_credentials) then
    raise exception 'BOOTSTRAP_ALREADY_COMPLETED';
  end if;

  if jsonb_typeof(p_staff) <> 'array'
     or jsonb_array_length(p_staff) <> 4
     or p_student_pin_proof !~ '^[a-f0-9]{64}$'
     or p_card_fingerprint !~ '^[a-f0-9]{64}$'
     or p_coupon_code_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'BAD_REQUEST';
  end if;

  for v_staff in select value from jsonb_array_elements(p_staff)
  loop
    if coalesce(v_staff->>'employeeCode', '') !~ '^[A-Za-z0-9_-]{2,32}$'
       or length(trim(coalesce(v_staff->>'displayName', ''))) not between 1 and 120
       or coalesce(v_staff->>'role', '') not in ('cashier','inventory_admin','accountant','super_admin')
       or coalesce(v_staff->>'pinProof', '') !~ '^[a-f0-9]{64}$' then
      raise exception 'BAD_REQUEST';
    end if;

    insert into public.staff_profiles(employee_code, display_name, role, active)
    values (
      v_staff->>'employeeCode',
      trim(v_staff->>'displayName'),
      (v_staff->>'role')::public.staff_role,
      true
    )
    on conflict (employee_code) do update
    set display_name = excluded.display_name,
        role = excluded.role,
        active = true,
        updated_at = v_now
    returning auth_user_id into v_staff_id;

    insert into private.staff_credentials(staff_user_id, pin_hash, failed_attempts, locked_until, pin_updated_at)
    values (
      v_staff_id,
      extensions.crypt(v_staff->>'pinProof', extensions.gen_salt('bf', 12)),
      0,
      null,
      v_now
    );
  end loop;

  select auth_user_id into v_inventory_admin_id
  from public.staff_profiles where employee_code = '2001' and role = 'inventory_admin';
  select auth_user_id into v_super_admin_id
  from public.staff_profiles where employee_code = '9001' and role = 'super_admin';
  if v_inventory_admin_id is null or v_super_admin_id is null then raise exception 'BAD_REQUEST'; end if;

  insert into private.students(student_code, display_name, active)
  values ('STU001', 'Demo Student', true)
  on conflict (student_code) do update
  set display_name = excluded.display_name, active = true, updated_at = v_now
  returning id into v_student_id;

  insert into private.student_credentials(student_id, pin_hash, failed_attempts, locked_until, pin_updated_at)
  values (
    v_student_id,
    extensions.crypt(p_student_pin_proof, extensions.gen_salt('bf', 12)),
    0,
    null,
    v_now
  )
  on conflict (student_id) do update
  set pin_hash = excluded.pin_hash, failed_attempts = 0, locked_until = null, pin_updated_at = v_now;

  insert into private.wallets(student_id, balance_won, updated_at)
  values (v_student_id, 20000, v_now)
  on conflict (student_id) do update set balance_won = 20000, updated_at = v_now;

  update private.student_cards
  set active = false, deactivated_at = v_now
  where student_id = v_student_id and active;
  insert into private.student_cards(student_id, card_fingerprint, active, issued_by)
  values (v_student_id, p_card_fingerprint, true, v_super_admin_id)
  on conflict (card_fingerprint) do update
  set student_id = excluded.student_id, active = true, deactivated_at = null;

  insert into private.terminals(terminal_fingerprint, label, active)
  values (encode(extensions.digest('campuspay-demo-bootstrap-terminal', 'sha256'), 'hex'), 'Demo bootstrap terminal', true)
  on conflict (terminal_fingerprint) do update set active = true, last_seen_at = v_now
  returning id into v_terminal_id;

  insert into private.staff_sessions(
    auth_user_id, employee_code_snapshot, role_snapshot, terminal_id,
    session_token_hash, last_activity_at, expires_at, revoked_at
  ) values (
    v_inventory_admin_id, '2001', 'inventory_admin', v_terminal_id,
    encode(extensions.digest('campuspay-demo-bootstrap-session', 'sha256'), 'hex'),
    v_now, v_now, v_now
  )
  on conflict (session_token_hash) do update
  set auth_user_id = excluded.auth_user_id,
      employee_code_snapshot = excluded.employee_code_snapshot,
      role_snapshot = excluded.role_snapshot,
      terminal_id = excluded.terminal_id,
      last_activity_at = excluded.last_activity_at,
      expires_at = excluded.expires_at,
      revoked_at = excluded.revoked_at
  returning id into v_session_id;

  insert into public.products(sku, name, category, selling_price_won, reorder_level, active, created_by)
  values
    ('WATER-001', 'Bottled Water', 'Drinks', 1200, 8, true, v_inventory_admin_id),
    ('JUICE-001', 'Fruit Juice', 'Drinks', 1800, 6, true, v_inventory_admin_id),
    ('CHIPS-001', 'Potato Chips', 'Snacks', 2000, 5, true, v_inventory_admin_id),
    ('COOKIE-001', 'Cookie', 'Snacks', 1500, 6, true, v_inventory_admin_id),
    ('SANDWICH-001', 'Sandwich', 'Food', 4500, 4, true, v_inventory_admin_id)
  on conflict (sku) do update
  set name = excluded.name,
      category = excluded.category,
      selling_price_won = excluded.selling_price_won,
      reorder_level = excluded.reorder_level,
      active = true,
      updated_at = v_now;

  insert into private.stock_receipts(
    receipt_number, supplier_name, supplier_invoice, purchase_date,
    purchase_subtotal_won, shipping_won, other_costs_won, discount_won,
    total_landed_cost_won, notes, received_by, staff_session_id, idempotency_key
  ) values (
    'DEMO-RCV-000001', 'CampusPay Demo Supplier', 'DEMO-INVOICE-001', current_date,
    122000, 0, 0, 0, 122000, 'Initial demo catalog stock',
    v_inventory_admin_id, v_session_id, '10000000-0000-4000-8000-000000000001'::uuid
  )
  on conflict (receipt_number) do update set notes = excluded.notes
  returning id into v_receipt_id;

  for v_product in
    select p.id, p.sku, seed.quantity, seed.unit_cost, seed.lot_code
    from public.products p
    join (values
      ('WATER-001', 40, 500::bigint, 'DEMO-WATER-01'),
      ('JUICE-001', 30, 800::bigint, 'DEMO-JUICE-01'),
      ('CHIPS-001', 25, 900::bigint, 'DEMO-CHIPS-01'),
      ('COOKIE-001', 30, 600::bigint, 'DEMO-COOKIE-01'),
      ('SANDWICH-001', 15, 2500::bigint, 'DEMO-SANDWICH-01')
    ) as seed(sku, quantity, unit_cost, lot_code) on seed.sku = p.sku
    order by p.sku
  loop
    insert into private.stock_receipt_lines(
      receipt_id, product_id, quantity, purchase_unit_cost_won, base_cost_won,
      allocated_overhead_won, allocated_discount_won, total_landed_cost_won,
      supplier_lot_code, expiration_date
    ) values (
      v_receipt_id, v_product.id, v_product.quantity, v_product.unit_cost,
      v_product.quantity::bigint * v_product.unit_cost,
      0, 0, v_product.quantity::bigint * v_product.unit_cost,
      v_product.lot_code, current_date + 180
    )
    returning id into v_receipt_line_id;

    insert into private.inventory_lots(
      receipt_line_id, product_id, received_at, expiration_date,
      quantity_received, quantity_remaining, landed_unit_cost_won
    ) values (
      v_receipt_line_id, v_product.id, v_now, current_date + 180,
      v_product.quantity, v_product.quantity, v_product.unit_cost
    )
    returning id into v_lot_id;

    insert into private.inventory_movements(
      product_id, lot_id, movement_type, quantity_change, unit_cost_won, total_cost_won,
      reason_code, notes, staff_user_id, staff_session_id, source_type, source_id
    ) values (
      v_product.id, v_lot_id, 'PURCHASE_RECEIPT', v_product.quantity,
      v_product.unit_cost, v_product.quantity::bigint * v_product.unit_cost,
      'PURCHASE_RECEIPT', 'Initial demo catalog stock', v_inventory_admin_id,
      v_session_id, 'STOCK_RECEIPT', v_receipt_id
    );
  end loop;

  insert into private.coupons(
    idempotency_key, name, code_fingerprint, code_masked, discount_type,
    fixed_amount_won, percentage_bps, minimum_subtotal_won, max_discount_won,
    total_redemption_limit, per_student_limit, starts_at, ends_at, active, created_by, staff_session_id
  ) values (
    '20000000-0000-4000-8000-000000000001'::uuid,
    'Welcome 10% Off', p_coupon_code_fingerprint, '••••ME10', 'PERCENTAGE',
    null, 1000, 1000, 2000, 1000, 1, v_now - interval '1 day', null, true,
    v_inventory_admin_id, v_session_id
  )
  on conflict (code_fingerprint) do update
  set name = excluded.name,
      active = true,
      percentage_bps = excluded.percentage_bps,
      minimum_subtotal_won = excluded.minimum_subtotal_won,
      max_discount_won = excluded.max_discount_won,
      total_redemption_limit = excluded.total_redemption_limit,
      per_student_limit = excluded.per_student_limit,
      starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      deactivated_by = null,
      deactivated_at = null,
      deactivation_reason = null;

  insert into private.audit_events(
    event_type, actor_user_id, approver_user_id, staff_session_id,
    subject_type, subject_id, reference_number, safe_payload
  ) values (
    'DEMO_BOOTSTRAP_COMPLETED', v_super_admin_id, v_super_admin_id, v_session_id,
    'SYSTEM', null, 'AUD-DEMO-BOOTSTRAP',
    jsonb_build_object('staff_count', 4, 'product_count', 5, 'student_count', 1)
  );

  return query select 4, 5, 1, v_now;
end;
$$;

revoke all on function api.bootstrap_demo(jsonb, text, text, text) from public;
grant execute on function api.bootstrap_demo(jsonb, text, text, text) to campuspay_runtime;
