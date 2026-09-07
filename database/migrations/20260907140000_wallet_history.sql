-- Read-only accounting history. Runtime retains no private-table access.
create or replace function api.student_wallet_history(p_session_id uuid,p_student_id uuid)
returns table(reference_number text,amount_won bigint,balance_before_won bigint,balance_after_won bigint,entry_type text,reason_code text,notes text,created_at timestamptz,actor_name text)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id,'wallet.read');
  return query select l.reference_number,l.amount_won,l.balance_before_won,l.balance_after_won,l.entry_type,l.reason_code,l.notes,l.created_at,coalesce(s.display_name,'Online store')
    from private.wallet_ledger l left join public.staff_profiles s on s.auth_user_id=l.staff_user_id
    where l.student_id=p_student_id order by l.created_at desc,l.id desc limit 100;
end;
$$;
revoke all on function api.student_wallet_history(uuid,uuid) from public;
grant execute on function api.student_wallet_history(uuid,uuid) to campuspay_runtime;

create or replace function api.inventory_product_register(p_session_id uuid)
returns table(id uuid,sku text,name text,category text,selling_price_won bigint,stock_on_hand bigint,sold_out boolean,reorder_level integer,low_stock boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_session(p_session_id,'inventory.read');
  return query select p.id,p.sku,p.name,p.category,p.selling_price_won,coalesce(q.quantity,0),coalesce(q.quantity,0)=0,p.reorder_level,coalesce(q.quantity,0)<=p.reorder_level
  from public.products p left join (select l.product_id,sum(l.quantity_remaining)::bigint quantity from private.inventory_lots l group by l.product_id) q on q.product_id=p.id
  where p.active order by p.name,p.id;
end;
$$;
revoke all on function api.inventory_product_register(uuid) from public;
grant execute on function api.inventory_product_register(uuid) to campuspay_runtime;
