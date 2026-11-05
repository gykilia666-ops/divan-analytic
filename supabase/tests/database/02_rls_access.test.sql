-- RLS, grants и прямой доступ в обход Next.js (CLAUDE.md §13). Роли переключаются как в PostgREST.
-- Подсчеты ограничены своими строками: в локальной БД могут быть данные синхронизации и интеграционных тестов.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@test.local', '{"user_name":"alice"}'),
  ('00000000-0000-4000-8000-00000000000b', 'b@test.local', '{"user_name":"bobby"}');

-- публичные данные и прогноз пользователя B (создаем от postgres)
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c0000000-0000-4000-8000-000000000001', 'pgtap', '1', 'LD', 'Лига Дивана', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'pgtap', '1', 'Красный Диван'),
  ('e1000000-0000-4000-8000-000000000002', 'pgtap', '2', 'Пикник-Сити');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status) values
  ('f1000000-0000-4000-8000-000000000001', 'pgtap', '1', 'c0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', '2026-11-10T15:00:00Z', 'SCHEDULED');
insert into public.markets (id, match_id, type, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli) values
  ('d1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'MATCH_RESULT_1X2', 1, 'demo-v1', 2350, 3100, 2900);

-- ======================================================= A и B выбирают псевдоним: создаются профиль и кошелек (ADR-075)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.set_pseudonym('Alice Z') ->> 'ok')::boolean, true, 'A выбрал псевдоним: профиль и кошелек созданы');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((public.set_pseudonym('Bobby Z') ->> 'ok')::boolean, true, 'B выбрал псевдоним');
reset role;

insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
values ('00000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000001', 'HOME', 100, 2350, 235,
        'b1000000-0000-4000-8000-000000000001', 'hb');

-- ======================================================= пользователь A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is((select count(*) from public.profiles), 1::bigint, 'A видит только свой профиль');
select is((select display_name from public.profiles), 'Alice Z',
  'в профиле выбранный псевдоним, а не логин из OAuth-метаданных (ADR-072)');
select is((select count(*) from public.wallets), 1::bigint, 'A видит только свой кошелек');
select is((select balance from public.wallets), 10000::bigint, 'стартовый баланс A = 10000');
select is((select count(*) from public.wallet_entries), 1::bigint, 'A видит только свой журнал');
select is((select count(*) from public.bets), 0::bigint, 'A не видит прогноз B');
select is((select count(*) from public.matches where provider = 'pgtap'), 1::bigint, 'матчи публичны');
select is((select count(*) from public.markets where id = 'd1000000-0000-4000-8000-000000000001'), 1::bigint, 'рынки публичны');

select throws_ok($$ update public.wallets set balance = 999999 $$, '42501', null,
  'A не может напрямую менять кошелек');
select throws_ok($$ insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'ADMIN_ADJUSTMENT', 1000, 'hack') $$, '42501', null,
  'A не может писать в журнал');
select throws_ok($$ insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'HOME', 100, 2350, 235,
          'b1000000-0000-4000-8000-000000000002', 'x') $$, '42501', null,
  'A не может создавать прогнозы напрямую в обход place_bet');
select throws_ok($$ update public.markets set status = 'CLOSED' $$, '42501', null,
  'A не может менять рынки');
select throws_ok($$ update public.matches set status = 'FINISHED' $$, '42501', null,
  'A не может менять матчи');
select throws_ok($$ select * from public.user_roles $$, '42501', null,
  'A не имеет доступа к user_roles');
select throws_ok($$ update public.profiles set disabled_at = null $$, '42501', null,
  'A не может менять служебные поля профиля');
select throws_ok($$ update public.profiles set display_name = 'Alice Z' $$, '42501', null,
  'A не может менять имя напрямую: только через set_pseudonym');
select is(public.set_pseudonym('Другое Имя') ->> 'code', 'ALREADY_SET', 'A не может сменить выбранный псевдоним (ADR-073)');
select is(public.set_pseudonym('x') ->> 'code', 'INVALID_NAME', 'слишком короткое имя отклоняется');

select is((public.set_pseudonym('Alice Z') ->> 'ok')::boolean, true,
  'повторный выбор того же имени проходит и монеты не начисляет');
select is((select balance from public.wallets), 10000::bigint, 'баланс A после повторного вызова не изменился');
reset role;

select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  'Alice Z', 'имя A сохранено');
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'Bobby Z', 'имя B не затронуто действиями A');

-- ======================================================= пользователь B видит свой прогноз
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*) from public.bets), 1::bigint, 'B видит свой прогноз');
reset role;

-- ======================================================= аутентифицированная роль без токена
set local role authenticated;
set local request.jwt.claims = '{}';
select throws_ok($$ select public.set_pseudonym('Без Токена') $$, '28000', null,
  'без sub в токене выбрать псевдоним нельзя');
reset role;

-- ======================================================= гость
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from public.matches where provider = 'pgtap'), 1::bigint, 'гость видит матчи');
select is((select count(*) from public.markets where id = 'd1000000-0000-4000-8000-000000000001'), 1::bigint, 'гость видит рынки');
select throws_ok($$ select * from public.wallets $$, '42501', null, 'гость не читает кошельки');
select throws_ok($$ select * from public.bets $$, '42501', null, 'гость не читает прогнозы');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'гость не читает профили');
select throws_ok($$ select public.set_pseudonym('Гость Имя') $$, '42501', null,
  'гость не может вызвать set_pseudonym (EXECUTE отозван)');
select hasnt_function('public', 'ensure_user_initialized', 'инициализация при входе удалена (ADR-075)');
select throws_ok($$ select public.market_transition_allowed('OPEN', 'CLOSED') $$, '42501', null,
  'служебные функции недоступны клиентам');
reset role;

select * from finish();
rollback;
