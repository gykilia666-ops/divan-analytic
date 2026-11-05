-- Прогноз принимается только у игрока с выбранным псевдонимом (ADR-074, уточнение ADR-072).
-- Раньше place_bet работал и для профиля без имени (ADR-072 это допускал); теперь такой профиль получает
-- {ok:false, code:'PSEUDONYM_REQUIRED'}, ничего не пишется и лимит частоты не расходуется. Остальное тело
-- функции — из миграции 20261106000001_place_bet.sql без изменений (порядок блокировок прежний).
-- Правило в БД, а не только в интерфейсе: прямой вызов RPC с токеном пользователя его не обходит.
-- Права на функцию create or replace не меняет (EXECUTE только у authenticated).

create or replace function public.place_bet(
  p_market_id uuid,
  p_outcome text,
  p_stake integer,
  p_quote_version integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_disabled timestamptz;
  v_pseudonym text;
  v_bet public.bets%rowtype;
  v_market public.markets%rowtype;
  v_match public.matches%rowtype;
  v_enabled boolean;
  v_balance bigint;
  v_odds integer;
begin
  if v_uid is null then
    return public.bet_error('UNAUTHENTICATED');
  end if;

  if p_market_id is null or p_idempotency_key is null or p_quote_version is null
     or p_outcome is null or p_outcome not in ('HOME', 'DRAW', 'AWAY')
     or p_stake is null or p_stake < 10 or p_stake > 1000 then
    return public.bet_error('VALIDATION_ERROR');
  end if;

  -- Отпечаток команды: тот же ключ с другим содержимым — конфликт.
  v_hash := md5(concat_ws('|', p_market_id::text, p_outcome, p_stake::text, p_quote_version::text));

  select p.disabled_at, p.display_name into v_disabled, v_pseudonym
  from public.profiles p where p.id = v_uid;
  if not found then
    return public.bet_error('ACCOUNT_NOT_READY');
  end if;
  if v_disabled is not null then
    return public.bet_error('ACCOUNT_DISABLED');
  end if;
  -- Аккаунт полноценный только со связкой «GitHub — псевдоним» (ADR-074): пока игрок не выбрал
  -- псевдоним, прогноз не принимается. Проверка стоит до повторов и лимита частоты и не расходует лимит.
  if v_pseudonym is null then
    return public.bet_error('PSEUDONYM_REQUIRED');
  end if;

  -- Повтор уже принятой команды: исходный результат, даже если рынок успел закрыться.
  -- Повторы не расходуют лимит частоты.
  select * into v_bet from public.bets b
    where b.user_id = v_uid and b.idempotency_key = p_idempotency_key;
  if found then
    if v_bet.request_hash <> v_hash then
      return public.bet_error('IDEMPOTENCY_CONFLICT');
    end if;
    return public.bet_success(v_bet, (select w.balance from public.wallets w where w.user_id = v_uid), true);
  end if;

  if not public.rate_limit_hit('place_bet:' || v_uid::text, 10, 60) then
    return public.bet_error('RATE_LIMITED');
  end if;

  select * into v_market from public.markets mk where mk.id = p_market_id for share;
  if not found then
    return public.bet_error('NOT_FOUND');
  end if;
  select * into v_match from public.matches m where m.id = v_market.match_id for share;
  select c.enabled into v_enabled from public.competitions c where c.id = v_match.competition_id;

  -- Время решает независимо от того, закрыла ли синхронизация рынок.
  if v_market.status <> 'OPEN'
     or v_match.status <> 'SCHEDULED'
     or not coalesce(v_enabled, false)
     or now() >= v_match.kickoff_at - interval '5 minutes' then
    return public.bet_error('MARKET_CLOSED');
  end if;
  if v_match.last_seen_at < now() - interval '60 minutes' then
    return public.bet_error('DATA_STALE');
  end if;
  if v_market.quote_version <> p_quote_version then
    return public.bet_error('QUOTE_CHANGED', jsonb_build_object('quoteVersion', v_market.quote_version));
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id = v_uid for update;
  if not found then
    return public.bet_error('ACCOUNT_NOT_READY');
  end if;

  -- Кошелек заблокирован: параллельные запросы этого пользователя уже зафиксированы и видны.
  select * into v_bet from public.bets b
    where b.user_id = v_uid and b.idempotency_key = p_idempotency_key;
  if found then
    if v_bet.request_hash <> v_hash then
      return public.bet_error('IDEMPOTENCY_CONFLICT');
    end if;
    return public.bet_success(v_bet, v_balance, true);
  end if;
  if exists (select 1 from public.bets b where b.user_id = v_uid and b.market_id = p_market_id) then
    return public.bet_error('ALREADY_PLACED');
  end if;
  if v_balance < p_stake then
    return public.bet_error('INSUFFICIENT_BALANCE');
  end if;

  v_odds := case p_outcome
    when 'HOME' then v_market.home_odds_milli
    when 'DRAW' then v_market.draw_odds_milli
    else v_market.away_odds_milli
  end;

  insert into public.bets (
    user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout,
    idempotency_key, request_hash
  )
  values (
    v_uid, p_market_id, p_outcome::public.bet_outcome, p_stake, v_odds,
    (p_stake::bigint * v_odds) / 1000, p_idempotency_key, v_hash
  )
  returning * into v_bet;

  insert into public.wallet_entries (user_id, kind, amount, bet_id, operation_key)
  values (v_uid, 'STAKE_DEBIT', -p_stake, v_bet.id, 'stake:' || v_bet.id::text);

  update public.wallets set balance = balance - p_stake
    where user_id = v_uid
    returning balance into v_balance;

  return public.bet_success(v_bet, v_balance, false);
end;
$$;
