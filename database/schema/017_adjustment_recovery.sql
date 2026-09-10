-- Resolve an interrupted wallet adjustment on the same register, including after sign-in.
create or replace function api.recover_wallet_adjustment(p_session_id uuid,p_intent_id uuid)
returns table(state text,receipt jsonb)
language plpgsql security definer set search_path = '' as $$
declare ss private.staff_sessions; i private.wallet_adjustment_intents; entry private.wallet_ledger; original_terminal uuid;
begin
  ss:=private.assert_session(p_session_id,'wallet.adjust');
  select * into i from private.wallet_adjustment_intents where id=p_intent_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select terminal_id into original_terminal from private.staff_sessions where id=i.staff_session_id;
  if original_terminal is distinct from ss.terminal_id then raise exception 'FORBIDDEN'; end if;
  if i.state='completed' and i.completed_ledger_id is not null then
    select * into entry from private.wallet_ledger where id=i.completed_ledger_id;
    return query select 'completed'::text,jsonb_build_object('reference_number',entry.reference_number,'amount_won',entry.amount_won,
      'balance_before_won',entry.balance_before_won,'balance_after_won',entry.balance_after_won,
      'debt_after_won',greatest(0::bigint,-entry.balance_after_won),'created_at',entry.created_at);
  else
    update private.wallet_adjustment_intents set state='cancelled',updated_at=now() where id=i.id;
    return query select 'cancelled'::text,null::jsonb;
  end if;
end;
$$;
revoke all on function api.recover_wallet_adjustment(uuid,uuid) from public;
grant execute on function api.recover_wallet_adjustment(uuid,uuid) to campuspay_runtime;
