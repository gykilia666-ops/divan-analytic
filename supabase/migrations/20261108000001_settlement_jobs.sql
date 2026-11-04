-- Подтверждение результата, расчет, возвраты, аренда заданий, журнал запусков, аудит (CLAUDE.md §9.4,
-- §9.5, §10.3–10.7). Этап 7.
--
-- ПОРЯДОК БЛОКИРОВОК (расширяет ADR-037):
--   job_leases → rate_limit_buckets → markets → matches → bets → wallets (по возрастанию user_id)
-- Расчет держит строку аренды FOR SHARE до конца транзакции: новый владелец не получит аренду, пока
-- старый не закончил запись, а устаревший владелец не начнет запись (fencing по generation).

-- ---------------------------------------------------------------- аудит и конфликт результата
create table public.audit_events (
  id bigint generated always as identity primary key,
  kind text not null constraint audit_events_kind_not_empty check (char_length(kind) > 0),
  match_id uuid references public.matches (id) on delete restrict,
  market_id uuid references public.markets (id) on delete restrict,
  user_id uuid references public.profiles (id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_match_idx on public.audit_events (match_id, created_at desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;

-- Итог изменился после расчета: дальнейшие автоматические действия по матчу приостановлены.
alter table public.matches add column result_conflict_at timestamptz;

-- ---------------------------------------------------------------- аренда заданий и журнал запусков
create table public.job_leases (
  job_name text primary key,
  lease_owner uuid,
  lease_until timestamptz,
  generation bigint not null default 0 constraint job_leases_generation_non_negative check (generation >= 0)
);
alter table public.job_leases enable row level security;
revoke all on public.job_leases from anon, authenticated;

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  lease_generation bigint,
  status text not null default 'RUNNING'
    constraint job_runs_status_valid check (status in ('RUNNING', 'OK', 'PARTIAL', 'SKIPPED', 'FAILED')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  error_code text
);
create index job_runs_job_started_idx on public.job_runs (job_name, started_at desc);
alter table public.job_runs enable row level security;
revoke all on public.job_runs from anon, authenticated;

-- Аренда: выдается, если ее нет или она истекла; каждый раз новое поколение. null — занято.
create function public.job_acquire_lease(p_job text, p_owner uuid, p_seconds integer)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_generation bigint;
begin
  if p_job is null or p_owner is null or p_seconds is null or p_seconds < 1 or p_seconds > 3600 then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;
  insert into public.job_leases (job_name) values (p_job) on conflict do nothing;
  update public.job_leases
    set lease_owner = p_owner,
        lease_until = clock_timestamp() + make_interval(secs => p_seconds),
        generation = generation + 1
    where job_name = p_job
      and (lease_until is null or lease_until <= clock_timestamp())
    returning generation into v_generation;
  return v_generation;
end;
$$;

-- Освобождение только владельцем того же поколения.
create function public.job_release_lease(p_job text, p_owner uuid, p_generation bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.job_leases
    set lease_until = null
    where job_name = p_job and lease_owner = p_owner and generation = p_generation;
  return found;
end;
$$;

-- Fencing: аренда действительна и удерживается FOR SHARE до конца транзакции вызывающей функции.
create function public.job_assert_lease(p_job text, p_owner uuid, p_generation bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.job_leases l
    where l.job_name = p_job
      and l.lease_owner = p_owner
      and l.generation = p_generation
      and l.lease_until > clock_timestamp()
    for share;
  if not found then
    raise exception 'LEASE_LOST' using errcode = '55000';
  end if;
end;
$$;

create function public.job_run_start(p_job text, p_generation bigint)
returns uuid
language sql
set search_path = ''
as $$
  insert into public.job_runs (job_name, lease_generation) values (p_job, p_generation) returning id
$$;

create function public.job_run_finish(p_run uuid, p_status text, p_summary jsonb, p_error text)
returns void
language sql
set search_path = ''
as $$
  update public.job_runs
    set status = p_status, summary = coalesce(p_summary, '{}'::jsonb), error_code = p_error,
        finished_at = now()
    where id = p_run
$$;

-- ---------------------------------------------------------------- подтверждение результата
-- Отпечаток наблюдения: завершен с однозначным итогом основного времени, отменен или перенесен.
create function public.match_result_fingerprint(
  p_status public.match_status,
  p_kind public.match_result_kind,
  p_home integer,
  p_away integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status = 'FINISHED' and p_kind = 'REGULAR' and p_home is not null and p_away is not null
      then 'FINISHED:' || p_home || ':' || p_away
    when p_status = 'CANCELLED' then 'CANCELLED'
    when p_status = 'POSTPONED' then 'POSTPONED'
    else null
  end
$$;

-- Подтверждение (§10.6): одинаковый отпечаток на двух успешных наблюдениях, разделенных минимум
-- p_min_interval_seconds. Если отпечаток изменился после расчета — конфликт и аудит, без перезаписи.
create function public.sync_confirm_results(p_provider text, p_min_interval_seconds integer default 600)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_fp text;
  v_settled boolean;
  v_observed integer := 0;
  v_confirmed integer := 0;
  v_conflicts integer := 0;
begin
  for r in
    select m.id, m.status, m.result_kind, m.regulation_home_score as home, m.regulation_away_score as away,
           m.result_fingerprint, m.result_first_seen_at, m.result_confirmed_at, m.result_conflict_at,
           m.last_seen_at
    from public.matches m
    where m.provider = p_provider
      and (
        m.result_fingerprint is distinct from public.match_result_fingerprint(
          m.status, m.result_kind, m.regulation_home_score, m.regulation_away_score)
        or (m.result_fingerprint is not null and m.result_confirmed_at is null)
      )
    order by m.id
    for update
  loop
    v_fp := public.match_result_fingerprint(r.status, r.result_kind, r.home, r.away);

    if v_fp is distinct from r.result_fingerprint then
      select exists (
        select 1 from public.markets mk
        where mk.match_id = r.id and mk.status = 'RESOLVED'
      ) into v_settled;

      if v_settled then
        -- Итог изменился после расчета по итогу: только конфликт и один аудит на событие.
        -- После VOID (отмена/перенос) ставки уже возвращены — изменения не считаются конфликтом.
        if r.result_conflict_at is null then
          update public.matches set result_conflict_at = now() where id = r.id;
          insert into public.audit_events (kind, match_id, details)
          values ('RESULT_CHANGED_AFTER_SETTLEMENT', r.id,
                  jsonb_build_object('settled_fingerprint', r.result_fingerprint, 'observed_fingerprint', v_fp));
          v_conflicts := v_conflicts + 1;
        end if;
      else
        update public.matches
          set result_fingerprint = v_fp,
              result_first_seen_at = case when v_fp is null then null else now() end,
              result_confirmed_at = null
          where id = r.id;
        if v_fp is not null then v_observed := v_observed + 1; end if;
      end if;

    elsif v_fp is not null
          and r.result_confirmed_at is null
          and r.last_seen_at >= r.result_first_seen_at + make_interval(secs => p_min_interval_seconds) then
      update public.matches set result_confirmed_at = now() where id = r.id;
      v_confirmed := v_confirmed + 1;
    end if;
  end loop;

  return jsonb_build_object('observed', v_observed, 'confirmed', v_confirmed, 'conflicts', v_conflicts);
end;
$$;

-- ---------------------------------------------------------------- расчет одного рынка
-- Возвращает 'RESOLVED' | 'VOID' | 'SKIPPED'. Повторный вызов — no-op: меняются только PENDING-прогнозы,
-- начисления защищены уникальными operation_key и индексом одного начисления на прогноз.
create function public.settle_market(p_market_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_market public.markets%rowtype;
  v_match public.matches%rowtype;
  v_void boolean;
  v_outcome public.bet_outcome;
begin
  select * into v_market from public.markets where id = p_market_id for update;
  if not found or v_market.status not in ('CLOSED', 'SUSPENDED') then
    return 'SKIPPED';
  end if;
  select * into v_match from public.matches where id = v_market.match_id for share;
  if v_match.result_conflict_at is not null then
    return 'SKIPPED';
  end if;

  if v_match.result_confirmed_at is not null and v_match.status = 'FINISHED'
     and v_match.result_kind = 'REGULAR'
     and v_match.regulation_home_score is not null and v_match.regulation_away_score is not null then
    v_void := false;
    v_outcome := case
      when v_match.regulation_home_score > v_match.regulation_away_score then 'HOME'
      when v_match.regulation_home_score < v_match.regulation_away_score then 'AWAY'
      else 'DRAW'
    end;
  elsif v_match.result_confirmed_at is not null and v_match.status in ('CANCELLED', 'POSTPONED') then
    v_void := true;
  elsif v_market.status = 'SUSPENDED' and v_match.status = 'SUSPENDED'
        and v_match.kickoff_at < now() - interval '48 hours' then
    v_void := true;
  else
    return 'SKIPPED';  -- нет подтвержденного однозначного итога: не угадываем
  end if;

  -- Прогнозы, затем кошельки в порядке user_id.
  perform 1 from public.bets where market_id = p_market_id and status = 'PENDING' order by id for update;
  perform 1 from public.wallets w
    where w.user_id in (select b.user_id from public.bets b where b.market_id = p_market_id and b.status = 'PENDING')
    order by w.user_id
    for update;

  with settled as (
    update public.bets b
      set status = case
            when v_void then 'VOID'::public.bet_status
            when b.outcome = v_outcome then 'WON'::public.bet_status
            else 'LOST'::public.bet_status
          end,
          actual_payout = case
            when v_void then b.stake
            when b.outcome = v_outcome then b.potential_payout
            else 0
          end,
          settled_at = now()
      where b.market_id = p_market_id and b.status = 'PENDING'
      returning b.id, b.user_id, b.status, b.actual_payout
  ),
  credits as (
    insert into public.wallet_entries (user_id, kind, amount, bet_id, operation_key)
    select s.user_id,
           case when s.status = 'WON' then 'WIN_CREDIT'::public.wallet_entry_kind
                else 'VOID_REFUND'::public.wallet_entry_kind end,
           s.actual_payout,
           s.id,
           case when s.status = 'WON' then 'win:' else 'refund:' end || s.id::text
    from settled s
    where s.status in ('WON', 'VOID') and s.actual_payout > 0
    returning user_id, amount
  )
  update public.wallets w
    set balance = w.balance + t.total
    from (select c.user_id, sum(c.amount) as total from credits c group by c.user_id) t
    where w.user_id = t.user_id;

  if v_void then
    update public.markets set status = 'VOID', resolved_at = now() where id = p_market_id;
    return 'VOID';
  end if;
  update public.markets
    set status = 'RESOLVED', resolved_outcome = v_outcome, resolved_at = now()
    where id = p_market_id;
  return 'RESOLVED';
end;
$$;

-- Пачка расчетов под арендой задания. Ограничена p_limit: остаток продолжит следующий запуск.
-- Сбой одного рынка не останавливает остальные (аудит SETTLEMENT_FAILED); потеря аренды — останавливает всё.
create function public.settle_ready_markets(p_job text, p_owner uuid, p_generation bigint, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_result text;
  v_resolved integer := 0;
  v_void integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
begin
  perform public.job_assert_lease(p_job, p_owner, p_generation);

  for r in
    select mk.id
    from public.markets mk
    join public.matches m on m.id = mk.match_id
    where mk.status in ('CLOSED', 'SUSPENDED')
      and m.result_conflict_at is null
      and (
        (m.result_confirmed_at is not null and m.status in ('FINISHED', 'CANCELLED', 'POSTPONED'))
        or (mk.status = 'SUSPENDED' and m.status = 'SUSPENDED' and m.kickoff_at < now() - interval '48 hours')
      )
    order by m.kickoff_at, mk.id
    limit least(greatest(coalesce(p_limit, 50), 1), 500)
  loop
    begin
      v_result := public.settle_market(r.id);
      if v_result = 'RESOLVED' then v_resolved := v_resolved + 1;
      elsif v_result = 'VOID' then v_void := v_void + 1;
      else v_skipped := v_skipped + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.audit_events (kind, market_id, details)
      values ('SETTLEMENT_FAILED', r.id, jsonb_build_object('sqlstate', sqlstate));
    end;
  end loop;

  return jsonb_build_object('resolved', v_resolved, 'void', v_void, 'skipped', v_skipped, 'failed', v_failed);
end;
$$;

-- ---------------------------------------------------------------- очистка временных данных
create function public.job_cleanup()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_buckets integer;
  v_runs integer;
begin
  delete from public.rate_limit_buckets where window_start < now() - interval '1 day';
  get diagnostics v_buckets = row_count;
  delete from public.job_runs where started_at < now() - interval '30 days';
  get diagnostics v_runs = row_count;
  return jsonb_build_object('rateLimitBuckets', v_buckets, 'jobRuns', v_runs);
end;
$$;

-- ---------------------------------------------------------------- ручной разбор (§9.5)
-- Компенсация — новая запись журнала, без правки истории и без ухода в минус.
create function public.admin_compensate(
  p_user_id uuid,
  p_amount bigint,
  p_reason text,
  p_operation_key text
)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_balance bigint;
begin
  if p_amount is null or p_amount = 0 or p_reason is null or char_length(btrim(p_reason)) < 5
     or p_operation_key is null or char_length(p_operation_key) = 0 then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;
  select balance into v_balance from public.wallets where user_id = p_user_id for update;
  if not found then
    raise exception 'WALLET_NOT_FOUND' using errcode = '22023';
  end if;
  if v_balance + p_amount < 0 then
    raise exception 'NEGATIVE_BALANCE' using errcode = '23514';
  end if;

  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values (p_user_id, 'ADMIN_ADJUSTMENT', p_amount, 'admin:' || p_operation_key);
  update public.wallets set balance = balance + p_amount where user_id = p_user_id
    returning balance into v_balance;
  insert into public.audit_events (kind, user_id, details)
  values ('ADMIN_COMPENSATION', p_user_id,
          jsonb_build_object('amount', p_amount, 'reason', p_reason, 'operation_key', p_operation_key));
  return v_balance;
end;
$$;

-- После ручной проверки конфликта: принять наблюдаемый отпечаток как подтвержденный и снять паузу.
-- Рассчитанные прогнозы не меняются; при необходимости — admin_compensate.
create function public.admin_ack_result_conflict(p_match_id uuid, p_note text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_match public.matches%rowtype;
  v_fp text;
begin
  if p_note is null or char_length(btrim(p_note)) < 5 then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.result_conflict_at is null then
    raise exception 'NO_CONFLICT' using errcode = '22023';
  end if;
  v_fp := public.match_result_fingerprint(v_match.status, v_match.result_kind,
                                          v_match.regulation_home_score, v_match.regulation_away_score);
  update public.matches
    set result_fingerprint = v_fp, result_first_seen_at = coalesce(result_first_seen_at, now()),
        result_confirmed_at = case when v_fp is null then null else now() end,
        result_conflict_at = null
    where id = p_match_id;
  insert into public.audit_events (kind, match_id, details)
  values ('RESULT_CONFLICT_ACKNOWLEDGED', p_match_id, jsonb_build_object('note', p_note, 'fingerprint', v_fp));
end;
$$;

-- ---------------------------------------------------------------- права: только service_role
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.job_acquire_lease(text, uuid, integer)',
    'public.job_release_lease(text, uuid, bigint)',
    'public.job_assert_lease(text, uuid, bigint)',
    'public.job_run_start(text, bigint)',
    'public.job_run_finish(uuid, text, jsonb, text)',
    'public.match_result_fingerprint(public.match_status, public.match_result_kind, integer, integer)',
    'public.sync_confirm_results(text, integer)',
    'public.settle_market(uuid)',
    'public.settle_ready_markets(text, uuid, bigint, integer)',
    'public.job_cleanup()',
    'public.admin_compensate(uuid, bigint, text, text)',
    'public.admin_ack_result_conflict(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;

-- settle_market — внутренняя: вызывается только из settle_ready_markets (SECURITY DEFINER) под арендой,
-- поэтому ни один клиент, включая service_role, не может рассчитать рынок в обход fencing.
revoke all on function public.settle_market(uuid) from service_role;
