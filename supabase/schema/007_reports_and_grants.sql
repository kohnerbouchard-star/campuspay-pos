create or replace function api.report_sales(
  p_session_id uuid,
  p_from date default null,
  p_to date default null
)
returns table(
  receipt_number text,
  created_at timestamptz,
  cashier_name text,
  revenue_won bigint,
  cogs_won bigint,
  gross_profit_won bigint,
  student_code text,
  balance_after_won bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.sales');
  return query
  select s.receipt_number, s.created_at, sp.display_name,
    s.total_won, s.cost_of_goods_sold_won, s.total_won - s.cost_of_goods_sold_won,
    st.student_code, wl.balance_after_won
  from private.sales s
  join public.staff_profiles sp on sp.auth_user_id = s.cashier_user_id
  join private.students st on st.id = s.student_id
  join private.wallet_ledger wl on wl.id = s.wallet_ledger_id
  where (p_from is null or s.created_at >= p_from::timestamptz)
    and (p_to is null or s.created_at < (p_to + 1)::timestamptz)
  order by s.created_at desc
  limit 5000;
end;
$$;

create or replace function api.report_inventory(p_session_id uuid)
returns table(
  product_name text,
  sku text,
  quantity_on_hand bigint,
  inventory_value_won bigint,
  oldest_receipt_date date,
  next_expiration_date date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.inventory');
  return query
  select p.name, p.sku,
    coalesce(sum(l.quantity_remaining),0)::bigint,
    coalesce(round(sum(l.quantity_remaining * l.landed_unit_cost_won)),0)::bigint,
    min(r.purchase_date) filter (where l.quantity_remaining > 0),
    min(l.expiration_date) filter (where l.quantity_remaining > 0 and l.expiration_date is not null)
  from public.products p
  left join private.inventory_lots l on l.product_id = p.id
  left join private.stock_receipt_lines rl on rl.id = l.receipt_line_id
  left join private.stock_receipts r on r.id = rl.receipt_id
  where p.active
  group by p.id, p.name, p.sku
  order by p.name;
end;
$$;

create or replace function api.report_wallets(p_session_id uuid)
returns table(
  student_code text,
  display_name text,
  balance_won bigint,
  debt_won bigint,
  last_movement_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_session(p_session_id, 'reports.wallets');
  return query
  select s.student_code, s.display_name, w.balance_won,
    greatest(0::bigint, -w.balance_won), max(wl.created_at)
  from private.students s
  join private.wallets w on w.student_id = s.id
  left join private.wallet_ledger wl on wl.student_id = s.id
  where s.active
  group by s.id, s.student_code, s.display_name, w.balance_won
  order by case when w.balance_won < 0 then 0 else 1 end, s.display_name;
end;
$$;

-- Functions are not executable by default merely because the schema is exposed.
revoke all on all functions in schema api from public, anon;
grant execute on all functions in schema api to authenticated;

alter default privileges in schema api revoke execute on functions from public, anon;
alter default privileges in schema api grant execute on functions to authenticated;
