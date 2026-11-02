-- Защита инвариантов на уровне БД (CLAUDE.md §6.6, §8.2, §9). Этап 2.
-- Нарушение «штатных» правил поднимает SQLSTATE 55000 (object_not_in_prerequisite_state),
-- нарушение баланса журнала — 23514 (check_violation).

-- ---------------------------------------------------------------- переходы статусов рынка
-- OPEN -> SUSPENDED | CLOSED | VOID; SUSPENDED -> OPEN | CLOSED | RESOLVED | VOID;
-- CLOSED -> SUSPENDED | RESOLVED | VOID; RESOLVED и VOID терминальны (не переоткрываются).
create function public.market_transition_allowed(
  p_from public.market_status,
  p_to public.market_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'OPEN' then p_to in ('SUSPENDED', 'CLOSED', 'VOID')
    when 'SUSPENDED' then p_to in ('OPEN', 'CLOSED', 'RESOLVED', 'VOID')
    when 'CLOSED' then p_to in ('SUSPENDED', 'RESOLVED', 'VOID')
    else false
  end
$$;

create function public.markets_validate_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.market_transition_allowed(old.status, new.status) then
    raise exception 'MARKET_TRANSITION_NOT_ALLOWED: % -> %', old.status, new.status
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger markets_validate_transition
  before update of status on public.markets
  for each row
  when (old.status is distinct from new.status)
  execute function public.markets_validate_transition();

-- ---------------------------------------------------------------- прогнозы неизменяемы
-- Меняться могут только status, actual_payout и settled_at, и только из PENDING.
create function public.bets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'BET_IMMUTABLE: deleting bets is not allowed' using errcode = '55000';
  end if;

  if old.status <> 'PENDING' then
    raise exception 'BET_IMMUTABLE: bet is already settled' using errcode = '55000';
  end if;

  if (new.user_id, new.market_id, new.outcome, new.stake, new.accepted_odds_milli,
      new.potential_payout, new.idempotency_key, new.request_hash, new.created_at)
     is distinct from
     (old.user_id, old.market_id, old.outcome, old.stake, old.accepted_odds_milli,
      old.potential_payout, old.idempotency_key, old.request_hash, old.created_at)
  then
    raise exception 'BET_IMMUTABLE: accepted bet fields cannot change' using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger bets_guard_update before update on public.bets
  for each row execute function public.bets_guard();
create trigger bets_guard_delete before delete on public.bets
  for each row execute function public.bets_guard();

-- ---------------------------------------------------------------- журнал append-only
create function public.wallet_entries_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LEDGER_APPEND_ONLY: ledger entries cannot be changed or deleted'
    using errcode = '55000';
  return null;
end;
$$;

create trigger wallet_entries_append_only
  before update or delete on public.wallet_entries
  for each row execute function public.wallet_entries_append_only();

-- ---------------------------------------------------------------- balance = SUM(журнала)
-- Отложенная проверка: срабатывает при COMMIT, поэтому запись журнала и обновление кошелька
-- можно делать в любом порядке внутри одной транзакции.
create function public.check_wallet_ledger_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_balance bigint;
  v_sum bigint;
begin
  select w.balance into v_balance from public.wallets w where w.user_id = new.user_id;
  select coalesce(sum(e.amount), 0) into v_sum
    from public.wallet_entries e where e.user_id = new.user_id;

  if v_balance is distinct from v_sum then
    raise exception 'WALLET_LEDGER_MISMATCH: balance % does not match ledger sum %', v_balance, v_sum
      using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger wallets_ledger_consistency
  after insert or update on public.wallets
  deferrable initially deferred
  for each row execute function public.check_wallet_ledger_consistency();

create constraint trigger wallet_entries_ledger_consistency
  after insert on public.wallet_entries
  deferrable initially deferred
  for each row execute function public.check_wallet_ledger_consistency();
