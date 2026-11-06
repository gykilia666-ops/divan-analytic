-- Каталог матчей и обслуживание рынков (docs/requirements.md §6.4, §6.6, §7, §10.3 шаги 8–9). Этап 5.

-- ---------------------------------------------------------------- витрина каталога
-- security_invoker: читающий видит только то, что ему разрешают RLS и grants базовых таблиц.
-- db_now — часы PostgreSQL: по ним UI считает закрытие приема и свежесть данных.
create view public.match_catalog
with (security_invoker = true)
as
select
  m.id,
  m.provider,
  m.provider_id,
  c.code as competition_code,
  c.name as competition_name,
  th.name as home_name,
  ta.name as away_name,
  m.kickoff_at,
  m.status,
  m.regulation_home_score as home_score,
  m.regulation_away_score as away_score,
  m.result_kind,
  m.last_seen_at,
  mk.id as market_id,
  mk.status as market_status,
  mk.quote_version,
  mk.model_version,
  mk.home_odds_milli,
  mk.draw_odds_milli,
  mk.away_odds_milli,
  now() as db_now
from public.matches m
join public.competitions c on c.id = m.competition_id and c.enabled
join public.teams th on th.id = m.home_team_id
join public.teams ta on ta.id = m.away_team_id
left join public.markets mk on mk.match_id = m.id and mk.type = 'MATCH_RESULT_1X2';

grant select on public.match_catalog to anon, authenticated, service_role;

-- Страница каталога: фильтры, стабильная сортировка (kickoff_at, id) и курсор.
-- scope: all/upcoming — по возрастанию времени; finished — по убыванию.
create function public.list_matches(
  p_provider text,
  p_competition text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_scope text default 'all',
  p_after_kickoff timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 20
)
returns setof public.match_catalog
language sql
stable
set search_path = ''
as $$
  select c.*
  from public.match_catalog c
  where c.provider = p_provider
    and (p_competition is null or c.competition_code = p_competition)
    and (p_from is null or c.kickoff_at >= p_from)
    and (p_to is null or c.kickoff_at < p_to)
    and case coalesce(p_scope, 'all')
          when 'finished' then c.status in ('FINISHED', 'CANCELLED')
          when 'upcoming' then c.status not in ('FINISHED', 'CANCELLED')
          else true
        end
    and (
      p_after_kickoff is null or p_after_id is null
      or (p_scope = 'finished' and (c.kickoff_at, c.id) < (p_after_kickoff, p_after_id))
      or (coalesce(p_scope, 'all') <> 'finished' and (c.kickoff_at, c.id) > (p_after_kickoff, p_after_id))
    )
  order by
    case when p_scope = 'finished' then c.kickoff_at end desc,
    case when p_scope = 'finished' then c.id end desc,
    c.kickoff_at asc,
    c.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 100) + 1
$$;
-- +1 строка: по ней сервер понимает, есть ли следующая страница.

revoke all on function public.list_matches(text, text, timestamptz, timestamptz, text, timestamptz, uuid, integer)
  from public;
grant execute on function public.list_matches(text, text, timestamptz, timestamptz, text, timestamptz, uuid, integer)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- обслуживание рынков
-- Закрытие и приостановка по часам PostgreSQL (шаг 8). Отмененный матч в этапе 5 только
-- приостанавливается: VOID с возвратом ставок делает расчет (этап 7). Терминальные рынки и
-- приостановленные рынки автоматически не переоткрываются.
create function public.sync_close_markets()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_suspended integer := 0;
  v_closed integer := 0;
  v_count integer;
begin
  update public.markets mk
    set status = 'SUSPENDED'
    from public.matches m
    where mk.match_id = m.id
      and mk.status = 'OPEN'
      and m.status in ('POSTPONED', 'SUSPENDED', 'CANCELLED');
  get diagnostics v_suspended = row_count;

  update public.markets mk
    set status = 'CLOSED'
    from public.matches m
    where mk.match_id = m.id
      and mk.status = 'OPEN'
      and (m.kickoff_at <= now() + interval '5 minutes' or m.status in ('LIVE', 'FINISHED'));
  get diagnostics v_closed = row_count;

  -- Прерванный и затем доигранный матч: рынок нужно закрыть, чтобы его мог рассчитать этап 7.
  update public.markets mk
    set status = 'CLOSED'
    from public.matches m
    where mk.match_id = m.id
      and mk.status = 'SUSPENDED'
      and m.status in ('LIVE', 'FINISHED');
  get diagnostics v_count = row_count;
  v_closed := v_closed + v_count;

  return jsonb_build_object('suspended', v_suspended, 'closed', v_closed);
end;
$$;

-- Матчи, которым нужен рынок (шаг 9): запланированы, до старта больше 5 минут, итога нет,
-- соревнование включено, рынка еще нет.
create function public.sync_matches_needing_market(p_provider text, p_limit integer default 200)
returns table (match_id uuid, provider_id text)
language sql
stable
set search_path = ''
as $$
  select m.id, m.provider_id
  from public.matches m
  join public.competitions c on c.id = m.competition_id and c.enabled
  where m.provider = p_provider
    and m.status = 'SCHEDULED'
    and m.result_kind = 'NONE'
    and m.kickoff_at > now() + interval '5 minutes'
    and not exists (
      select 1 from public.markets mk
      where mk.match_id = m.id and mk.type = 'MATCH_RESULT_1X2'
    )
  order by m.kickoff_at, m.id
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

-- Создание рынков с уже рассчитанными коэффициентами. Повторный вызов ничего не дублирует,
-- коэффициенты существующего рынка не меняются (фиксируются при создании). Условия приема
-- перепроверяются здесь, по часам БД; диапазон коэффициентов проверяют CHECK-ограничения.
create function public.sync_create_markets(p_model_version text, p_items jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_model_version is null or char_length(btrim(p_model_version)) = 0 then
    raise exception 'INVALID_MODEL_VERSION' using errcode = '22023';
  end if;

  insert into public.markets (
    match_id, type, status, quote_version, model_version,
    home_odds_milli, draw_odds_milli, away_odds_milli
  )
  select distinct on (i.match_id)
    i.match_id, 'MATCH_RESULT_1X2', 'OPEN', 1, p_model_version, i.home, i.draw, i.away
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
    as i (match_id uuid, home integer, draw integer, away integer)
  join public.matches m on m.id = i.match_id
  where m.status = 'SCHEDULED'
    and m.result_kind = 'NONE'
    and m.kickoff_at > now() + interval '5 minutes'
  order by i.match_id
  on conflict (match_id, type) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sync_close_markets() from public, anon, authenticated;
revoke all on function public.sync_matches_needing_market(text, integer) from public, anon, authenticated;
revoke all on function public.sync_create_markets(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_close_markets() to service_role;
grant execute on function public.sync_matches_needing_market(text, integer) to service_role;
grant execute on function public.sync_create_markets(text, jsonb) to service_role;
