-- Админ-диагностика (CLAUDE.md §6.1, §10, §11.1, §20.2). Этап 9.
-- Роль берется только из user_roles (не из редактируемого профиля и не из user metadata).
-- Все функции администратора — SECURITY DEFINER с проверкой роли внутри: прямой вызов API обычным
-- пользователем получает FORBIDDEN (42501), гость не имеет права EXECUTE вовсе.

-- ---------------------------------------------------------------- роль
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = (select auth.uid()) and r.role = 'ADMIN' and p.disabled_at is null
  )
$$;

create function public.admin_assert()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------- причина ожидания расчета
-- Чистая функция: та же логика, что ветвления settle_market (ADR-042/043), но с объяснением.
create function public.settlement_wait_reason(
  p_market_status public.market_status,
  p_match_status public.match_status,
  p_result_kind public.match_result_kind,
  p_has_score boolean,
  p_confirmed_at timestamptz,
  p_conflict_at timestamptz,
  p_kickoff_at timestamptz,
  p_now timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_conflict_at is not null then 'RESULT_CONFLICT'
    when p_market_status = 'OPEN' then 'MARKET_NOT_CLOSED'
    when p_match_status in ('SCHEDULED', 'LIVE') then 'NOT_FINISHED'
    when p_match_status = 'SUSPENDED' then
      case when p_kickoff_at < p_now - interval '48 hours' then 'READY' else 'SUSPENDED_WAIT' end
    when p_match_status = 'FINISHED' and (p_result_kind = 'AMBIGUOUS') then 'AMBIGUOUS_RESULT'
    when p_match_status = 'FINISHED' and (p_result_kind <> 'REGULAR' or not p_has_score) then 'NO_RESULT_DATA'
    when p_confirmed_at is null then 'AWAITING_CONFIRMATION'
    else 'READY'
  end
$$;

-- ---------------------------------------------------------------- обзор
create function public.admin_overview(p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_result jsonb;
begin
  perform public.admin_assert();

  select jsonb_build_object(
    'now', v_now,
    'lastSuccessAt', (select max(started_at) from public.job_runs where job_name = 'sync' and status = 'OK'),
    'lastFailure', (
      select jsonb_build_object('startedAt', r.started_at, 'status', r.status, 'errorCode', r.error_code,
                                'errors', coalesce(r.summary -> 'errors', '[]'::jsonb))
      from public.job_runs r
      where r.job_name = 'sync' and r.status in ('FAILED', 'PARTIAL')
      order by r.started_at desc limit 1
    ),
    'lease', (
      select jsonb_build_object('generation', l.generation, 'leaseUntil', l.lease_until,
                                'held', l.lease_until is not null and l.lease_until > v_now)
      from public.job_leases l where l.job_name = 'sync'
    ),
    'runs', coalesce((
      select jsonb_agg(x order by x ->> 'startedAt' desc)
      from (
        select jsonb_build_object(
          'id', r.id, 'status', r.status, 'startedAt', r.started_at, 'finishedAt', r.finished_at,
          'generation', r.lease_generation, 'errorCode', r.error_code,
          'requests', coalesce((r.summary -> 'sync' ->> 'requests')::int, 0),
          'syncStatus', r.summary -> 'sync' ->> 'status',
          'settled', coalesce((r.summary -> 'settlement' ->> 'resolved')::int, 0)
                   + coalesce((r.summary -> 'settlement' ->> 'void')::int, 0),
          'errors', coalesce(r.summary -> 'errors', '[]'::jsonb)
        ) as x
        from public.job_runs r
        where r.job_name = 'sync'
        order by r.started_at desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'requests24h', coalesce((
      select sum(coalesce((r.summary -> 'sync' ->> 'requests')::int, 0))
      from public.job_runs r where r.job_name = 'sync' and r.started_at > v_now - interval '24 hours'
    ), 0),
    'providerBudget', (
      select jsonb_build_object('windowStart', p.window_start, 'requestCount', p.request_count,
                                'nextAllowedAt', p.next_allowed_at)
      from public.provider_rate_limits p where p.provider = p_provider
    ),
    'staleMatches', (
      select count(*) from public.matches m
      where m.provider = p_provider and m.status in ('SCHEDULED', 'LIVE')
        and m.kickoff_at between v_now - interval '6 hours' and v_now + interval '10 days'
        and m.last_seen_at < v_now - interval '60 minutes'
    ),
    'conflicts', (
      select count(*) from public.matches m where m.provider = p_provider and m.result_conflict_at is not null
    ),
    'settlementFailures24h', (
      select count(*) from public.audit_events a
      where a.kind = 'SETTLEMENT_FAILED' and a.created_at > v_now - interval '24 hours'
    )
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- очередь расчета
-- Рынки, которые еще не рассчитаны, хотя матч уже начался (или закрыт/приостановлен), и матчи
-- с конфликтом результата (их рынки уже рассчитаны, но нужен разбор).
create function public.admin_pending_settlements(p_provider text, p_limit integer default 50)
returns table (
  market_id uuid,
  match_id uuid,
  kickoff_at timestamptz,
  competition_name text,
  home_name text,
  away_name text,
  match_status text,
  market_status text,
  result_kind text,
  home_score integer,
  away_score integer,
  result_first_seen_at timestamptz,
  result_confirmed_at timestamptz,
  result_conflict_at timestamptz,
  last_seen_at timestamptz,
  pending_bets bigint,
  reason text,
  last_failure_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  return query
    select k.id, m.id, m.kickoff_at, c.name, ht.name, at.name,
           m.status::text, k.status::text, m.result_kind::text,
           m.regulation_home_score, m.regulation_away_score,
           m.result_first_seen_at, m.result_confirmed_at, m.result_conflict_at, m.last_seen_at,
           (select count(*) from public.bets b where b.market_id = k.id and b.status = 'PENDING'),
           public.settlement_wait_reason(k.status, m.status, m.result_kind,
             m.regulation_home_score is not null, m.result_confirmed_at, m.result_conflict_at,
             m.kickoff_at, now()),
           (select max(a.created_at) from public.audit_events a
             where a.kind = 'SETTLEMENT_FAILED' and a.market_id = k.id)
    from public.markets k
    join public.matches m on m.id = k.match_id
    join public.competitions c on c.id = m.competition_id
    join public.teams ht on ht.id = m.home_team_id
    join public.teams at on at.id = m.away_team_id
    where m.provider = p_provider
      and (
        k.status in ('CLOSED', 'SUSPENDED')
        or (k.status = 'OPEN' and m.kickoff_at <= now())
        or m.result_conflict_at is not null  -- конфликт возникает у уже рассчитанных рынков
      )
    order by m.kickoff_at, k.id
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- ---------------------------------------------------------------- действия администратора
-- Ручной запуск: не чаще 1 раза в 60 секунд на всех администраторов (общий бюджет поставщика).
-- Сам запуск выполняет сервер под арендой задания; здесь — проверка роли, лимит и аудит.
create function public.admin_request_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  if not public.rate_limit_hit('admin:sync', 1, 60) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;
  insert into public.audit_events (kind, user_id, details)
  values ('ADMIN_SYNC_REQUESTED', (select auth.uid()), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Снять паузу конфликта, приняв наблюдаемый итог (§9.5). Запись аудита с автором.
create function public.admin_resolve_conflict(p_match_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  perform public.admin_ack_result_conflict(p_match_id, p_note);
  insert into public.audit_events (kind, match_id, user_id, details)
  values ('ADMIN_CONFLICT_RESOLVED', p_match_id, (select auth.uid()), jsonb_build_object('note', p_note));
end;
$$;

-- ---------------------------------------------------------------- права
revoke all on function public.is_admin() from public, anon;
revoke all on function public.admin_assert() from public, anon, authenticated, service_role;
revoke all on function public.settlement_wait_reason(public.market_status, public.match_status,
  public.match_result_kind, boolean, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.admin_overview(text) from public, anon;
revoke all on function public.admin_pending_settlements(text, integer) from public, anon;
revoke all on function public.admin_request_sync() from public, anon;
revoke all on function public.admin_resolve_conflict(uuid, text) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_overview(text) to authenticated;
grant execute on function public.admin_pending_settlements(text, integer) to authenticated;
grant execute on function public.admin_request_sync() to authenticated;
grant execute on function public.admin_resolve_conflict(uuid, text) to authenticated;
