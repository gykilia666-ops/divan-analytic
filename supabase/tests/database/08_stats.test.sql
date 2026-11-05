-- Статистика и рейтинг (§6.9, §6.10). Этап 8. Свой поставщик pgtap-st; проверки фильтруют своих
-- пользователей, поэтому данные других тестов не мешают.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ======================================================= 8 матчей, рынки 2.00 / 3.00 / 4.00
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c8000000-0000-4000-8000-000000000001', 'pgtap-st', '1', 'SS', 'Лига статистики', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e8000000-0000-4000-8000-000000000001', 'pgtap-st', '1', 'Хозяева'),
  ('e8000000-0000-4000-8000-000000000002', 'pgtap-st', '2', 'Гости');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status, last_seen_at)
select ('f8000000-0000-4000-8000-00000000000' || n)::uuid, 'pgtap-st', 'm' || n,
       'c8000000-0000-4000-8000-000000000001', 'e8000000-0000-4000-8000-000000000001',
       'e8000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()
from generate_series(1, 8) n;
insert into public.markets (id, match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli)
select ('a8000000-0000-4000-8000-00000000000' || n)::uuid, ('f8000000-0000-4000-8000-00000000000' || n)::uuid,
       'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000
from generate_series(1, 8) n;

-- a: 4 выигрыша, 2 проигрыша, 1 возврат, 1 ожидает.  b, f: одинаковые −300 (порядок по user_id).
-- c: лучшая прибыль, но 4 рассчитанных.  d: отключен.  e: без прогнозов.  g: +200 при 5 рассчитанных.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000008a1', 'a8@test.local', '{"user_name":"stat_a"}'),
  ('00000000-0000-4000-8000-0000000008b1', 'b8@test.local', '{"user_name":"stat_b"}'),
  ('00000000-0000-4000-8000-0000000008c1', 'c8@test.local', '{"user_name":"stat_c"}'),
  ('00000000-0000-4000-8000-0000000008d1', 'd8@test.local', '{"user_name":"stat_d"}'),
  ('00000000-0000-4000-8000-0000000008e1', 'e8@test.local', '{"user_name":"stat_e"}'),
  ('00000000-0000-4000-8000-0000000008f1', 'f8@test.local', '{"user_name":"stat_f"}'),
  ('00000000-0000-4000-8000-0000000008f2', 'g8@test.local', '{"user_name":"stat_g"}'),
  ('00000000-0000-4000-8000-0000000008f3', 'hidden8@test.local', '{"user_name":"stat_h"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;
-- Ставки пользователя: строка исходов по рынкам 1..n ('H' хозяева, 'A' гости, '.' пропуск).
create function pg_temp.bets(p_uid text, p_plan text, p_stake int) returns void language plpgsql as $f$
declare v jsonb; i int;
begin
  perform pg_temp.as_user(p_uid);
  -- Профиль, кошелек и кредит создаются выбором псевдонима (ADR-075); повторный вызов даст ALREADY_SET, это не ошибка.
  perform public.set_pseudonym('Игрок ' || right(p_uid, 3));
  for i in 1 .. length(p_plan) loop
    continue when substr(p_plan, i, 1) = '.';
    v := public.place_bet(('a8000000-0000-4000-8000-00000000000' || i)::uuid,
      case substr(p_plan, i, 1) when 'H' then 'HOME' else 'AWAY' end, p_stake, 1, gen_random_uuid());
    if not (v ->> 'ok')::boolean then raise exception 'bet failed: %', v; end if;
  end loop;
end;
$f$;

-- Матчи 1–6: победа хозяев; 7: отмена (возврат); 8: не начался (ожидает).
do $$ begin
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008a1', 'HHHHAAHH', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008b1', 'HAAAA', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008c1', 'HHHH', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008d1', 'HHHHH', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008f1', 'HAAAA', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008f2', 'HHH', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008f2', '...AA', 50);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008f3', 'HHH', 100);
  perform pg_temp.bets('00000000-0000-4000-8000-0000000008f3', '...AA', 50);
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000008e1');
  perform public.set_pseudonym('Игрок 8e1');
end $$;
reset role;

-- Псевдоним выбирает пользователь (ADR-072); после входа имен нет. Для читаемости проверок задаем имена из метаданных теста.
update public.profiles p set display_name = u.raw_user_meta_data ->> 'user_name'
  from auth.users u
 where u.id = p.id and p.id::text like '00000000-0000-4000-8000-0000000008%';

-- До расчета: у всех только ожидающие, рейтинг пуст для наших.
select is((select count(*) from public.leaderboard_ranked() r join auth.users u on u.id = r.user_id
           where u.email like '%8@test.local'), 0::bigint, 'до расчета никто не допущен');

update public.matches set kickoff_at = now() - interval '3 hours', status = 'FINISHED', result_kind = 'REGULAR',
  regulation_home_score = 2, regulation_away_score = 0,
  result_first_seen_at = now() - interval '11 minutes', result_confirmed_at = now()
  where provider = 'pgtap-st' and provider_id in ('m1', 'm2', 'm3', 'm4', 'm5', 'm6');
update public.matches set status = 'CANCELLED', result_first_seen_at = now() - interval '11 minutes', result_confirmed_at = now()
  where provider = 'pgtap-st' and provider_id = 'm7';
update public.markets set status = 'CLOSED'
  where match_id in (select id from public.matches where provider = 'pgtap-st' and provider_id <> 'm8');
select is((select count(*) from (select public.settle_market(id) s from public.markets
           where match_id in (select id from public.matches where provider = 'pgtap-st' and provider_id <> 'm8')) x
           where s in ('RESOLVED', 'VOID')), 7::bigint, 'рассчитаны 7 рынков');
update public.profiles set disabled_at = now() where id = '00000000-0000-4000-8000-0000000008d1';

-- ======================================================= личная статистика
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000008a1'); end $$;
select is((select array[won_count, lost_count, void_count, pending_count, stakes, payouts] from public.my_stats()),
  array[4, 2, 1, 1, 600, 800]::bigint[], 'a: 4 выигрыша, 2 проигрыша; возврат и ожидающий не входят в суммы');
select is(public.my_leaderboard_place(), (select place from public.leaderboard() where display_name = 'stat_a'),
  'место a совпадает с публичным рейтингом');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000008e1'); end $$;
select is((select array[won_count, lost_count, void_count, pending_count, stakes, payouts] from public.my_stats()),
  array[0, 0, 0, 0, 0, 0]::bigint[], 'без прогнозов — нули, одна строка');
select is(public.my_leaderboard_place(), null::bigint, 'без прогнозов — нет места');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000008c1'); end $$;
select is(public.my_leaderboard_place(), null::bigint, '4 рассчитанных — не допущен');
select is((select won_count from public.my_stats()), 4::bigint, 'чужие прогнозы в my_stats не попадают');
reset role;

-- Проверочный пересчет по исходным прогнозам для всех наших пользователей: my_stats вызывается
-- от имени каждого (отдельный вызов на пользователя), результат сравнивается с прямым SQL.
create temporary table my_stats_seen (email text, won bigint, lost bigint, void bigint, pending bigint, stakes bigint, payouts bigint);
grant insert on my_stats_seen to authenticated;
do $$
declare u record;
begin
  for u in select id, email from auth.users where email like '%8@test.local' order by email loop
    perform pg_temp.as_user(u.id::text);
    insert into my_stats_seen select u.email, s.* from public.my_stats() s;
    perform set_config('role', 'postgres', true);
  end loop;
end $$;
reset role;
select results_eq(
  $$ select * from my_stats_seen order by email $$,
  $$ select u.email::text,
       count(*) filter (where b.status = 'WON'), count(*) filter (where b.status = 'LOST'),
       count(*) filter (where b.status = 'VOID'), count(*) filter (where b.status = 'PENDING'),
       coalesce(sum(b.stake) filter (where b.status in ('WON', 'LOST')), 0)::bigint,
       coalesce(sum(b.actual_payout) filter (where b.status in ('WON', 'LOST')), 0)::bigint
     from auth.users u left join public.bets b on b.user_id = u.id
     where u.email like '%8@test.local' group by u.email order by u.email $$,
  'my_stats совпадает с прямым пересчетом по bets для каждого пользователя'
);

-- ======================================================= рейтинг
select results_eq(
  $$ select r.display_name, r.settled_count, r.won_count, r.stakes, r.net_profit from public.leaderboard_ranked() r
     join auth.users u on u.id = r.user_id where u.email like '%8@test.local' order by r.place $$,
  $$ values ('stat_a'::text, 6::bigint, 4::bigint, 600::bigint, 200::bigint),
            ('stat_g', 5, 3, 400, 200),
            ('stat_h', 5, 3, 400, 200),
            ('stat_b', 5, 1, 500, -300),
            ('stat_f', 5, 1, 500, -300) $$,
  'допуск ≥ 5, отключенный скрыт, отдельного согласия не требуется; порядок: прибыль ↓, рассчитано ↓, user_id'
);
select results_eq(
  $$ select r.user_id, r.net_profit from public.leaderboard_ranked() r
     join auth.users u on u.id = r.user_id where u.email like '%8@test.local' order by r.user_id $$,
  $$ select b.user_id, (sum(b.actual_payout) - sum(b.stake))::bigint from public.bets b
     join public.profiles p on p.id = b.user_id join auth.users u on u.id = b.user_id
     where b.status in ('WON', 'LOST') and p.disabled_at is null and u.email like '%8@test.local'
     group by b.user_id having count(*) >= 5 order by b.user_id $$,
  'прибыль в рейтинге совпадает с прямым пересчетом (VOID и журнал не учитываются)'
);
select ok((select count(*) = count(distinct place) and min(place) = 1 and max(place) = count(*)
           from public.leaderboard_ranked()), 'места уникальны и идут подряд с 1');
select ok((select count(*) <= 1 from public.leaderboard(1)) and (select count(*) <= 100 from public.leaderboard(100000)),
  'limit ограничен 1..100');

-- ======================================================= рейтинг без отдельного согласия (ADR-076)
select is((select count(*) from public.leaderboard_ranked() r join auth.users u on u.id = r.user_id
           where u.email = 'hidden8@test.local'), 1::bigint,
  'игрок с псевдонимом и 5 рассчитанными попадает в рейтинг без отдельного согласия');
select is((select count(*) from public.leaderboard() where display_name = 'stat_h'), 1::bigint,
  'публичный рейтинг содержит такого игрока');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000008f3'); end $$;
select ok(public.my_leaderboard_place() is not null, 'место в рейтинге у игрока есть');
select is((select won_count from public.my_stats()), 3::bigint, 'личная статистика доступна');
reset role;

-- ======================================================= без псевдонима игрока нет в рейтинге (ADR-072)
update public.profiles set display_name = null where id = '00000000-0000-4000-8000-0000000008a1';
select is((select count(*) from public.leaderboard_ranked() where user_id = '00000000-0000-4000-8000-0000000008a1'),
  0::bigint, 'без псевдонима игрока нет в рейтинге, даже с 5 расчетными прогнозами');

-- ======================================================= приватность и права
select ok(pg_get_function_result('public.leaderboard(integer)'::regprocedure) !~ '(user_id|email|role|balance)',
  'публичный рейтинг не содержит user_id, email, ролей и баланса');
select ok(has_function_privilege('anon', 'public.leaderboard(integer)', 'execute'), 'гость видит рейтинг');
select ok(not has_function_privilege('anon', 'public.my_stats()', 'execute'), 'гость не вызывает my_stats');
select ok(not has_function_privilege('anon', 'public.my_leaderboard_place()', 'execute'), 'гость не вызывает my_leaderboard_place');
select ok(not has_function_privilege('authenticated', 'public.leaderboard_ranked()', 'execute')
  and not has_function_privilege('anon', 'public.leaderboard_ranked()', 'execute')
  and not has_function_privilege('service_role', 'public.leaderboard_ranked()', 'execute'),
  'внутренний рейтинг с user_id никому не выдан');

select * from finish();
rollback;
