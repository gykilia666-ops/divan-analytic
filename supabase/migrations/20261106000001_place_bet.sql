-- Прием прогноза, лимит частоты и история (CLAUDE.md §6.7, §6.8, §9.1–9.3, §13.5). Этап 6.
--
-- ПОРЯДОК БЛОКИРОВОК (обязателен для всех функций, меняющих деньги):
--   rate_limit_buckets → markets → matches → bets → wallets
-- place_bet: счетчик частоты (upsert строки), рынок FOR SHARE, матч FOR SHARE, кошелек FOR UPDATE.
-- Расчет и возвраты (этап 7) берут рынок FOR UPDATE, затем прогнозы, затем кошельки в порядке user_id.
-- Начальная инициализация (ensure_user_initialized) рынков не касается: только profiles → wallets.
-- Внутри транзакций нет внешних вызовов и ожиданий.

-- ---------------------------------------------------------------- лимит частоты
-- Ключ — идентификатор действия и пользователя (не IP). Строки временные: очистка — этап 7.
create table public.rate_limit_buckets (
  bucket_key text primary key,
  window_start timestamptz not null,
  hits integer not null constraint rate_limit_buckets_hits_positive check (hits > 0)
);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from anon, authenticated;

-- true — запрос укладывается в лимит. Счетчик растет и при отказе: так же считаются и отклоненные
-- бизнес-проверкой попытки (place_bet возвращает ошибку, а не откатывает транзакцию).
create function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_hits integer;
begin
  insert into public.rate_limit_buckets as b (bucket_key, window_start, hits)
  values (p_key, v_now, 1)
  on conflict (bucket_key) do update set
    window_start = case
      when b.window_start + make_interval(secs => p_window_seconds) <= v_now then v_now
      else b.window_start end,
    hits = case
      when b.window_start + make_interval(secs => p_window_seconds) <= v_now then 1
      else b.hits + 1 end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------- ответы place_bet
create function public.bet_error(p_code text, p_details jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'details', coalesce(p_details, '{}'::jsonb))
$$;

create function public.bet_success(p_bet public.bets, p_balance bigint, p_replay boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ok', true,
    'replay', p_replay,
    'balance', p_balance,
    'bet', jsonb_build_object(
      'id', p_bet.id,
      'marketId', p_bet.market_id,
      'outcome', p_bet.outcome,
      'stake', p_bet.stake,
      'acceptedOddsMilli', p_bet.accepted_odds_milli,
      'potentialPayout', p_bet.potential_payout,
      'status', p_bet.status,
      'createdAt', p_bet.created_at
    )
  )
$$;

-- ---------------------------------------------------------------- place_bet
-- Бизнес-отказы возвращаются как {ok:false, code}, а не исключением: транзакция фиксируется, и счетчик
-- частоты учитывает попытку. Исключения — только для неожиданных ошибок (они не маскируются).
create function public.place_bet(
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

  select p.disabled_at into v_disabled from public.profiles p where p.id = v_uid;
  if not found then
    return public.bet_error('ACCOUNT_NOT_READY');
  end if;
  if v_disabled is not null then
    return public.bet_error('ACCOUNT_DISABLED');
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

-- ---------------------------------------------------------------- история прогнозов
-- security_invoker: RLS таблицы bets оставляет пользователю только его прогнозы.
create view public.bet_history
with (security_invoker = true)
as
select
  b.id,
  b.market_id,
  b.outcome,
  b.stake,
  b.accepted_odds_milli,
  b.potential_payout,
  b.actual_payout,
  b.status,
  b.created_at,
  b.settled_at,
  m.id as match_id,
  m.kickoff_at,
  m.status as match_status,
  m.regulation_home_score as home_score,
  m.regulation_away_score as away_score,
  c.name as competition_name,
  th.name as home_name,
  ta.name as away_name
from public.bets b
join public.markets mk on mk.id = b.market_id
join public.matches m on m.id = mk.match_id
join public.competitions c on c.id = m.competition_id
join public.teams th on th.id = m.home_team_id
join public.teams ta on ta.id = m.away_team_id;

grant select on public.bet_history to authenticated;

-- Страница истории: новые сверху, курсор (created_at, id), фильтр статуса.
create function public.list_my_bets(
  p_status text default null,
  p_after_created timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns setof public.bet_history
language sql
stable
set search_path = ''
as $$
  select h.*
  from public.bet_history h
  where (p_status is null or h.status::text = p_status)
    and (
      p_after_created is null or p_after_id is null
      or (h.created_at, h.id) < (p_after_created, p_after_id)
    )
  order by h.created_at desc, h.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100) + 1
$$;

-- ---------------------------------------------------------------- права
revoke all on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.bet_error(text, jsonb) from public, anon, authenticated;
revoke all on function public.bet_success(public.bets, bigint, boolean) from public, anon, authenticated;
revoke all on function public.place_bet(uuid, text, integer, integer, uuid) from public, anon;
revoke all on function public.list_my_bets(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.place_bet(uuid, text, integer, integer, uuid) to authenticated;
grant execute on function public.list_my_bets(text, timestamptz, uuid, integer) to authenticated;
