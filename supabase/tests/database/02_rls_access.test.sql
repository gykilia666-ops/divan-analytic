-- RLS, grants и прямой доступ в обход Next.js (CLAUDE.md §13). Роли переключаются как в PostgREST.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'a@test.local', '{"user_name":"alice"}'),
  ('00000000-0000-4000-8000-00000000000b', 'b@test.local', '{"user_name":"bobby"}');

-- публичные данные и прогноз пользователя B (создаем от postgres)
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c0000000-0000-4000-8000-000000000001', 'fixtures', '1', 'LD', 'Лига Дивана', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'fixtures', '1', 'Красный Диван'),
  ('e1000000-0000-4000-8000-000000000002', 'fixtures', '2', 'Пикник-Сити');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status) values
  ('f1000000-0000-4000-8000-000000000001', 'fixtures', '1', 'c0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', '2026-11-10T15:00:00Z', 'SCHEDULED');
insert into public.markets (id, match_id, type, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli) values
  ('d1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'MATCH_RESULT_1X2', 1, 'demo-v1', 2350, 3100, 2900);

-- ======================================================= инициализация A и B через RPC
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'A инициализирован');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'B инициализирован');
reset role;

insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
values ('00000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000001', 'HOME', 100, 2350, 235,
        'b1000000-0000-4000-8000-000000000001', 'hb');

-- ======================================================= пользователь A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select is((select count(*) from public.profiles), 1::bigint, 'A видит только свой профиль');
select is((select display_name from public.profiles), 'alice', 'имя профиля взято из OAuth-метаданных');
select is((select count(*) from public.wallets), 1::bigint, 'A видит только свой кошелек');
select is((select balance from public.wallets), 10000::bigint, 'стартовый баланс A = 10000');
select is((select count(*) from public.wallet_entries), 1::bigint, 'A видит только свой журнал');
select is((select count(*) from public.bets), 0::bigint, 'A не видит прогноз B');
select is((select count(*) from public.matches), 1::bigint, 'матчи публичны');
select is((select count(*) from public.markets), 1::bigint, 'рынки публичны');

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
select lives_ok($$ update public.profiles set display_name = 'Alice Z' $$,
  'A может менять свое отображаемое имя');
select lives_ok($$ update public.profiles set display_name = 'hacked' where id = '00000000-0000-4000-8000-00000000000b' $$,
  'попытка изменить чужой профиль не падает, но не затрагивает строк');
select throws_ok($$ update public.profiles set display_name = 'x' $$, '23514', null,
  'слишком короткое имя отклоняется ограничением');

select is((select credited from public.ensure_user_initialized()), false,
  'повторная инициализация не начисляет монеты');
select is((select balance from public.wallets), 10000::bigint, 'баланс A после повторного вызова не изменился');
reset role;

select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000a'),
  'Alice Z', 'имя A изменено');
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-00000000000b'),
  'bobby', 'имя B не изменилось');

-- ======================================================= пользователь B видит свой прогноз
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select is((select count(*) from public.bets), 1::bigint, 'B видит свой прогноз');
reset role;

-- ======================================================= аутентифицированная роль без токена
set local role authenticated;
set local request.jwt.claims = '{}';
select throws_ok($$ select * from public.ensure_user_initialized() $$, '28000', null,
  'без sub в токене инициализация невозможна');
reset role;

-- ======================================================= гость
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*) from public.matches), 1::bigint, 'гость видит матчи');
select is((select count(*) from public.markets), 1::bigint, 'гость видит рынки');
select throws_ok($$ select * from public.wallets $$, '42501', null, 'гость не читает кошельки');
select throws_ok($$ select * from public.bets $$, '42501', null, 'гость не читает прогнозы');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'гость не читает профили');
select throws_ok($$ select * from public.ensure_user_initialized() $$, '42501', null,
  'гость не может вызвать ensure_user_initialized (EXECUTE отозван)');
select throws_ok($$ select public.market_transition_allowed('OPEN', 'CLOSED') $$, '42501', null,
  'служебные функции недоступны клиентам');
reset role;

select * from finish();
rollback;
