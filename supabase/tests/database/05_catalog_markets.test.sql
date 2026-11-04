-- Каталог матчей и обслуживание рынков (CLAUDE.md §6.4, §6.6, §7). Этап 5.
-- Свой поставщик (pgtap-c): в локальной БД могут быть данные синхронизации и других тестов.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c5000000-0000-4000-8000-000000000001', 'pgtap-c', '1', 'TL', 'Тестовая лига', true),
  ('c5000000-0000-4000-8000-000000000002', 'pgtap-c', '2', 'OFF', 'Отключенная лига', false);
insert into public.teams (id, provider, provider_id, name) values
  ('e5000000-0000-4000-8000-000000000001', 'pgtap-c', '1', 'Хозяева'),
  ('e5000000-0000-4000-8000-000000000002', 'pgtap-c', '2', 'Гости');

-- m1 запланирован через 2 дня; m2 — через 3 минуты; m3 завершен; m4 перенесен; m5 в отключенной
-- лиге; m6 отменен.
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status, regulation_home_score, regulation_away_score, result_kind) values
  ('f5000000-0000-4000-8000-000000000001', 'pgtap-c', 'm1', 'c5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', null, null, 'NONE'),
  ('f5000000-0000-4000-8000-000000000002', 'pgtap-c', 'm2', 'c5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() + interval '3 minutes', 'SCHEDULED', null, null, 'NONE'),
  ('f5000000-0000-4000-8000-000000000003', 'pgtap-c', 'm3', 'c5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() - interval '2 days', 'FINISHED', 2, 1, 'REGULAR'),
  ('f5000000-0000-4000-8000-000000000004', 'pgtap-c', 'm4', 'c5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() + interval '1 day', 'POSTPONED', null, null, 'NONE'),
  ('f5000000-0000-4000-8000-000000000005', 'pgtap-c', 'm5', 'c5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', null, null, 'NONE'),
  ('f5000000-0000-4000-8000-000000000006', 'pgtap-c', 'm6', 'c5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000002', now() + interval '1 day', 'CANCELLED', null, null, 'NONE');

-- ======================================================= каталог (гость)
set local role anon;
select is(
  (select array_agg(provider_id order by kickoff_at, id) from public.list_matches('pgtap-c')),
  array['m3', 'm2', 'm4', 'm6', 'm1'],
  'гость видит каталог по времени начала; отключенная лига скрыта'
);
select is(
  (select array_agg(provider_id) from public.list_matches('pgtap-c', p_scope => 'finished')),
  array['m6', 'm3'],
  'завершенные и отмененные — по убыванию времени'
);
select is(
  (select count(*) from public.list_matches('pgtap-c', p_scope => 'upcoming')),
  3::bigint,
  'предстоящие: запланированные и перенесенный'
);
select is(
  (select count(*) from public.list_matches('pgtap-c', p_limit => 2)),
  3::bigint,
  'возвращается лимит + 1 строка — признак следующей страницы'
);
select is(
  (select array_agg(provider_id) from public.list_matches('pgtap-c',
     p_after_kickoff => (select kickoff_at from public.matches where provider_id = 'm2' and provider = 'pgtap-c'),
     p_after_id => 'f5000000-0000-4000-8000-000000000002')),
  array['m4', 'm6', 'm1'],
  'курсор: строго после (kickoff_at, id)'
);
select is(
  (select array_agg(provider_id) from public.list_matches('pgtap-c',
     p_from => now() + interval '12 hours', p_to => now() + interval '36 hours')),
  array['m4', 'm6'],
  'фильтр по интервалу [from, to)'
);
select is(
  (select count(*) from public.list_matches('pgtap-c', p_competition => 'XX')),
  0::bigint,
  'фильтр по соревнованию'
);
select is(
  (select count(*) from public.list_matches('other-provider')),
  0::bigint,
  'чужой поставщик не смешивается'
);
select ok((select db_now is not null from public.match_catalog where provider = 'pgtap-c' limit 1),
  'витрина отдает часы БД');
select throws_ok($$ select public.sync_close_markets() $$, '42501', null,
  'гость не вызывает обслуживание рынков');
select throws_ok($$ select * from public.sync_matches_needing_market('pgtap-c') $$, '42501', null,
  'гость не видит служебный список');
select throws_ok($$ select public.sync_create_markets('demo-v1', '[]'::jsonb) $$, '42501', null,
  'гость не создает рынки');
reset role;

set local role authenticated;
select is((select count(*) from public.list_matches('pgtap-c')), 5::bigint,
  'пользователь видит тот же каталог');
select throws_ok($$ select public.sync_create_markets('demo-v1', '[]'::jsonb) $$, '42501', null,
  'пользователь не создает рынки');
reset role;

-- ======================================================= создание рынков (service_role)
set local role service_role;
select is(
  (select array_agg(provider_id) from public.sync_matches_needing_market('pgtap-c')),
  array['m1'],
  'рынок нужен только запланированному матчу с запасом > 5 минут в включенной лиге'
);

select is(
  public.sync_create_markets('demo-v1', jsonb_build_array(
    jsonb_build_object('match_id', 'f5000000-0000-4000-8000-000000000001', 'home', 1836, 'draw', 4345, 'away', 3503),
    jsonb_build_object('match_id', 'f5000000-0000-4000-8000-000000000002', 'home', 2000, 'draw', 3000, 'away', 4000),
    jsonb_build_object('match_id', 'f5000000-0000-4000-8000-000000000003', 'home', 2000, 'draw', 3000, 'away', 4000))),
  1,
  'рынок не создается за 5 минут до старта и для завершенного матча'
);
select is(
  public.sync_create_markets('demo-v1', jsonb_build_array(
    jsonb_build_object('match_id', 'f5000000-0000-4000-8000-000000000001', 'home', 1500, 'draw', 1500, 'away', 1500))),
  0,
  'повторное создание ничего не дублирует'
);
select is(
  (select array[home_odds_milli, draw_odds_milli, away_odds_milli, quote_version]
   from public.markets where match_id = 'f5000000-0000-4000-8000-000000000001'),
  array[1836, 4345, 3503, 1],
  'коэффициенты зафиксированы при создании'
);
select is((select count(*) from public.sync_matches_needing_market('pgtap-c')), 0::bigint,
  'после создания кандидатов нет');
reset role;

-- Попытка открыть рынок с коэффициентом вне 1.10–12.00 отклоняется ограничением БД.
update public.matches set kickoff_at = now() + interval '3 days' where id = 'f5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$
  select public.sync_create_markets('demo-v1', jsonb_build_array(
    jsonb_build_object('match_id', 'f5000000-0000-4000-8000-000000000002', 'home', 1000, 'draw', 3000, 'away', 4000)))
$$, '23514', null, 'коэффициент ниже 1.10 не открывает рынок');
select throws_ok($$ select public.sync_create_markets(' ', '[]'::jsonb) $$, '22023', null,
  'пустая версия модели отклоняется');
reset role;
update public.matches set kickoff_at = now() + interval '3 minutes' where id = 'f5000000-0000-4000-8000-000000000002';

-- ======================================================= закрытие по времени
-- Рынки, «забытые» открытыми: m2 (до старта 3 минуты), m4 (перенесен), m6 (отменен).
insert into public.markets (match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli) values
  ('f5000000-0000-4000-8000-000000000002', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000),
  ('f5000000-0000-4000-8000-000000000004', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000),
  ('f5000000-0000-4000-8000-000000000006', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000);

-- Права service_role проверены выше; здесь вызов от владельца функции.
select ok(
  (select (r ->> 'suspended')::int >= 2 and (r ->> 'closed')::int >= 1
   from (select public.sync_close_markets() as r) x),
  'закрытие сообщает, сколько рынков приостановлено и закрыто'
);
select is(
  (select array_agg(mt.provider_id || ':' || mk.status::text order by mt.provider_id)
   from public.markets mk join public.matches mt on mt.id = mk.match_id where mt.provider = 'pgtap-c'),
  array['m1:OPEN', 'm2:CLOSED', 'm4:SUSPENDED', 'm6:SUSPENDED'],
  'время закрывает рынок; перенос и отмена приостанавливают; рынок с запасом остается открытым'
);

update public.matches set status = 'FINISHED', regulation_home_score = 1, regulation_away_score = 0,
  result_kind = 'REGULAR' where id = 'f5000000-0000-4000-8000-000000000004';
set local role service_role;
select lives_ok($$ select public.sync_close_markets() $$, 'повторное закрытие безопасно');
reset role;
select is(
  (select status::text from public.markets where match_id = 'f5000000-0000-4000-8000-000000000004'),
  'CLOSED',
  'приостановленный рынок завершившегося матча закрывается для расчета'
);
select is(
  (select status::text from public.markets where match_id = 'f5000000-0000-4000-8000-000000000006'),
  'SUSPENDED',
  'отмененный матч остается приостановленным до расчета (VOID — этап 7)'
);

update public.matches set status = 'SCHEDULED', kickoff_at = now() + interval '2 days'
  where id = 'f5000000-0000-4000-8000-000000000006';
set local role service_role;
select lives_ok($$ select public.sync_close_markets() $$, 'закрытие после «возврата» матча в расписание');
reset role;
select is(
  (select status::text from public.markets where match_id = 'f5000000-0000-4000-8000-000000000006'),
  'SUSPENDED',
  'приостановленный рынок автоматически не переоткрывается'
);

-- ======================================================= витрина показывает рынок
set local role anon;
select is(
  (select array[market_status::text, home_odds_milli::text]
   from public.match_catalog where provider = 'pgtap-c' and provider_id = 'm1'),
  array['OPEN', '1836'],
  'каталог показывает статус рынка и коэффициенты'
);
select is(
  (select count(*) from public.match_catalog where provider = 'pgtap-c' and provider_id = 'm5'),
  0::bigint,
  'матч отключенной лиги не попадает в витрину'
);
reset role;

-- ======================================================= область «можно сделать прогноз»
set local role anon;
select is(
  (select array_agg(provider_id) from public.list_matches('pgtap-c', p_scope => 'open')),
  array['m1'],
  'open: только открытый рынок запланированного матча с запасом > 5 минут'
);
reset role;

select * from finish();
rollback;
