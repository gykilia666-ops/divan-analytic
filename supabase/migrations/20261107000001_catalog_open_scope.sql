-- Каталог: область «open» — матчи, на которые можно сделать прогноз (по умолчанию в UI).
-- Новая миграция вместо правки примененной: сигнатура list_matches не меняется.
-- open = рынок OPEN, матч SCHEDULED, до старта больше 5 минут по часам БД. Устаревшие данные матч
-- не скрывают (временное состояние): карточка предупреждает, а place_bet все равно откажет.

create or replace function public.list_matches(
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
          when 'open' then c.status = 'SCHEDULED'
            and c.market_status = 'OPEN'
            and c.kickoff_at > now() + interval '5 minutes'
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
