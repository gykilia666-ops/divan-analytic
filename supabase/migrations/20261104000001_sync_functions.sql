-- Синхронизация спортивных данных (CLAUDE.md §10). Этап 4.
-- Все функции доступны ТОЛЬКО service_role: клиентам (anon/authenticated) EXECUTE не выдается.
-- Транзакции короткие; внешних HTTP-вызовов внутри SQL нет.

-- ---------------------------------------------------------------- лимитер запросов к поставщику
create table public.provider_rate_limits (
  provider text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0
    constraint provider_rate_limits_count_non_negative check (request_count >= 0),
  next_allowed_at timestamptz
);
alter table public.provider_rate_limits enable row level security;
revoke all on public.provider_rate_limits from anon, authenticated;
grant select, insert, update on public.provider_rate_limits to service_role;

-- Атомарно резервирует p_cost запросов в окне p_window_seconds. Одна строка на поставщика,
-- FOR UPDATE сериализует конкурентные вызовы (cron и ручной запуск делят один бюджет).
create function public.provider_try_acquire(
  p_provider text,
  p_limit integer,
  p_cost integer default 1,
  p_window_seconds integer default 60
)
returns table (allowed boolean, retry_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  r public.provider_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_provider is null or p_limit is null or p_cost is null or p_window_seconds is null
     or p_limit < 1 or p_cost < 1 or p_cost > p_limit or p_window_seconds < 1 then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;

  insert into public.provider_rate_limits (provider, window_start, request_count)
  values (p_provider, v_now, 0)
  on conflict do nothing;

  select * into r from public.provider_rate_limits where provider = p_provider for update;

  -- Поставщик ответил 429: до next_allowed_at не ходим.
  if r.next_allowed_at is not null and r.next_allowed_at > v_now then
    return query select false, r.next_allowed_at;
    return;
  end if;

  if r.window_start + make_interval(secs => p_window_seconds) <= v_now then
    update public.provider_rate_limits
      set window_start = v_now, request_count = 0, next_allowed_at = null
      where provider = p_provider;
    r.window_start := v_now;
    r.request_count := 0;
  end if;

  if r.request_count + p_cost > p_limit then
    return query select false, r.window_start + make_interval(secs => p_window_seconds);
    return;
  end if;

  update public.provider_rate_limits
    set request_count = request_count + p_cost, next_allowed_at = null
    where provider = p_provider;
  return query select true, null::timestamptz;
end;
$$;

-- Фиксирует ответ 429: не ходить к поставщику ближайшие p_retry_after_seconds (1..3600).
create function public.provider_report_rate_limited(
  p_provider text,
  p_retry_after_seconds integer default 60
)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_until timestamptz := clock_timestamp()
    + make_interval(secs => greatest(1, least(coalesce(p_retry_after_seconds, 60), 3600)));
  v_result timestamptz;
begin
  if p_provider is null then
    raise exception 'INVALID_ARGUMENTS' using errcode = '22023';
  end if;
  insert into public.provider_rate_limits (provider, next_allowed_at)
  values (p_provider, v_until)
  on conflict (provider) do update
    set next_allowed_at = greatest(
      coalesce(public.provider_rate_limits.next_allowed_at, excluded.next_allowed_at),
      excluded.next_allowed_at
    )
  returning next_allowed_at into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- upsert матчей
-- Правило свежести: более старое provider_updated_at не перезаписывает более новое состояние;
-- неизвестное (null) не новее известного. last_seen_at обновляется всегда.
create function public.sync_is_fresh(p_existing timestamptz, p_incoming timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_incoming is null then p_existing is null
    else p_existing is null or p_incoming >= p_existing
  end
$$;

-- Payload: {"competitions":[{provider_id,code,name}], "teams":[{provider_id,name,short_name}],
--           "matches":[{provider_id, competition_provider_id, home_provider_id, away_provider_id,
--                       kickoff_at, status, home_score, away_score, result_kind, provider_updated_at}]}
-- Функция атомарна: любая ошибка откатывает все изменения. Дубликаты внутри payload схлопываются
-- (иначе ON CONFLICT DO UPDATE падает на «повторном изменении той же строки»).
create function public.sync_upsert_matches(p_provider text, p_payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_inserted integer := 0;
  v_updated integer := 0;
begin
  if p_provider is null or char_length(btrim(p_provider)) = 0 then
    raise exception 'INVALID_PROVIDER' using errcode = '22023';
  end if;

  -- enabled при конфликте не трогаем: администратор мог отключить соревнование.
  insert into public.competitions (provider, provider_id, code, name, enabled)
  select distinct on (c.provider_id) p_provider, c.provider_id, c.code, c.name, true
  from jsonb_to_recordset(coalesce(p_payload -> 'competitions', '[]'::jsonb))
    as c (provider_id text, code text, name text)
  order by c.provider_id
  on conflict (provider, provider_id)
  do update set code = excluded.code, name = excluded.name;

  insert into public.teams (provider, provider_id, name, short_name)
  select distinct on (t.provider_id) p_provider, t.provider_id, t.name, t.short_name
  from jsonb_to_recordset(coalesce(p_payload -> 'teams', '[]'::jsonb))
    as t (provider_id text, name text, short_name text)
  order by t.provider_id
  on conflict (provider, provider_id)
  do update set name = excluded.name, short_name = excluded.short_name;

  -- Из дубликатов одного матча оставляем наблюдение с самым свежим provider_updated_at.
  with src as (
    select distinct on (m.provider_id) m.*
    from jsonb_to_recordset(coalesce(p_payload -> 'matches', '[]'::jsonb))
      as m (provider_id text, competition_provider_id text, home_provider_id text,
            away_provider_id text, kickoff_at timestamptz, status text, home_score integer,
            away_score integer, result_kind text, provider_updated_at timestamptz)
    order by m.provider_id, m.provider_updated_at desc nulls last
  ),
  incoming as (
    select
      i.provider_id,
      comp.id as competition_id,
      th.id as home_team_id,
      ta.id as away_team_id,
      i.kickoff_at,
      i.status::public.match_status as status,
      i.home_score,
      i.away_score,
      i.result_kind::public.match_result_kind as result_kind,
      i.provider_updated_at
    from src i
    join public.competitions comp
      on comp.provider = p_provider and comp.provider_id = i.competition_provider_id
    join public.teams th
      on th.provider = p_provider and th.provider_id = i.home_provider_id
    join public.teams ta
      on ta.provider = p_provider and ta.provider_id = i.away_provider_id
  ),
  upserted as (
    insert into public.matches as mt (
      provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status,
      regulation_home_score, regulation_away_score, result_kind, provider_updated_at, last_seen_at
    )
    select
      p_provider, i.provider_id, i.competition_id, i.home_team_id, i.away_team_id, i.kickoff_at,
      i.status, i.home_score, i.away_score, i.result_kind, i.provider_updated_at, now()
    from incoming i
    on conflict (provider, provider_id) do update set
      last_seen_at = now(),
      competition_id = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.competition_id else mt.competition_id end,
      home_team_id = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.home_team_id else mt.home_team_id end,
      away_team_id = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.away_team_id else mt.away_team_id end,
      kickoff_at = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.kickoff_at else mt.kickoff_at end,
      status = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.status else mt.status end,
      regulation_home_score = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.regulation_home_score else mt.regulation_home_score end,
      regulation_away_score = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.regulation_away_score else mt.regulation_away_score end,
      result_kind = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.result_kind else mt.result_kind end,
      provider_updated_at = case when public.sync_is_fresh(mt.provider_updated_at, excluded.provider_updated_at)
        then excluded.provider_updated_at else mt.provider_updated_at end
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted),
    count(*) filter (where not inserted),
    (select count(*) from src)
  into v_inserted, v_updated, v_total
  from upserted;

  -- Матч со ссылкой на отсутствующее соревнование/команду JOIN отбросил бы молча.
  if v_inserted + v_updated <> v_total then
    raise exception 'PAYLOAD_REFERENCE_MISSING: % of % matches resolved',
      v_inserted + v_updated, v_total using errcode = '22023';
  end if;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

-- Доступ только у service_role (PUBLIC-EXECUTE Postgres выдает по умолчанию — отзываем явно).
revoke all on function public.provider_try_acquire(text, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.provider_report_rate_limited(text, integer)
  from public, anon, authenticated;
revoke all on function public.sync_is_fresh(timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.sync_upsert_matches(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.provider_try_acquire(text, integer, integer, integer) to service_role;
grant execute on function public.provider_report_rate_limited(text, integer) to service_role;
grant execute on function public.sync_is_fresh(timestamptz, timestamptz) to service_role;
grant execute on function public.sync_upsert_matches(text, jsonb) to service_role;
