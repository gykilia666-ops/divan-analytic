-- Статистика и рейтинг (CLAUDE.md §6.9, §6.10). Этап 8.
-- Учитываются только рассчитанные WON/LOST; VOID и PENDING не входят в win rate, ROI и прибыль;
-- INITIAL_CREDIT и ADMIN_ADJUSTMENT — не игровая прибыль (считаем по bets, а не по журналу).

create index bets_user_settled_idx on public.bets (user_id) where status in ('WON', 'LOST');

-- ---------------------------------------------------------------- личная статистика
-- SECURITY INVOKER: RLS bets_select_own + явный фильтр по auth.uid().
create function public.my_stats()
returns table (
  won_count bigint,
  lost_count bigint,
  void_count bigint,
  pending_count bigint,
  stakes bigint,
  payouts bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where b.status = 'WON'),
    count(*) filter (where b.status = 'LOST'),
    count(*) filter (where b.status = 'VOID'),
    count(*) filter (where b.status = 'PENDING'),
    coalesce(sum(b.stake) filter (where b.status in ('WON', 'LOST')), 0)::bigint,
    coalesce(sum(b.actual_payout) filter (where b.status in ('WON', 'LOST')), 0)::bigint
  from public.bets b
  where b.user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- рейтинг
-- Внутренняя функция (никому не выдается): содержит user_id для «моего места».
-- Допуск: >= 5 рассчитанных WON/LOST, профиль не отключен.
-- Сортировка: net_profit DESC, settled_count DESC, user_id (стабильный технический tie-breaker).
create function public.leaderboard_ranked()
returns table (
  user_id uuid,
  place bigint,
  display_name text,
  avatar_url text,
  settled_count bigint,
  won_count bigint,
  stakes bigint,
  net_profit bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with agg as (
    select
      b.user_id,
      count(*) as settled_count,
      count(*) filter (where b.status = 'WON') as won_count,
      sum(b.stake)::bigint as stakes,
      (sum(b.actual_payout) - sum(b.stake))::bigint as net_profit
    from public.bets b
    where b.status in ('WON', 'LOST')
    group by b.user_id
    having count(*) >= 5
  )
  select
    a.user_id,
    row_number() over (order by a.net_profit desc, a.settled_count desc, a.user_id),
    p.display_name,
    p.avatar_url,
    a.settled_count,
    a.won_count,
    a.stakes,
    a.net_profit
  from agg a
  join public.profiles p on p.id = a.user_id
  where p.disabled_at is null
$$;

-- Публичный безопасный DTO: без user_id, email, ролей и журнала.
create function public.leaderboard(p_limit integer default 50)
returns table (
  place bigint,
  display_name text,
  avatar_url text,
  settled_count bigint,
  won_count bigint,
  stakes bigint,
  net_profit bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.place, r.display_name, r.avatar_url, r.settled_count, r.won_count, r.stakes, r.net_profit
  from public.leaderboard_ranked() r
  order by r.place
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- Место текущего пользователя; null — не допущен или не вошел.
create function public.my_leaderboard_place()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select r.place from public.leaderboard_ranked() r where r.user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- права
revoke all on function public.leaderboard_ranked() from public, anon, authenticated, service_role;
revoke all on function public.my_stats() from public, anon;
revoke all on function public.my_leaderboard_place() from public, anon;
revoke all on function public.leaderboard(integer) from public;
grant execute on function public.my_stats() to authenticated;
grant execute on function public.my_leaderboard_place() to authenticated;
grant execute on function public.leaderboard(integer) to anon, authenticated, service_role;
