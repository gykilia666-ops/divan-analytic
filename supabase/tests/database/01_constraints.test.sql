-- Ограничения, защитные триггеры и инварианты журнала (CLAUDE.md §8.2). Запускается от postgres.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@test.local');
insert into public.profiles (id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', 'Alice');
insert into public.wallets (user_id, balance) values
  ('00000000-0000-4000-8000-00000000000a', 0);

insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c0000000-0000-4000-8000-000000000001', 'fixtures', '1', 'LD', 'Лига Дивана', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'fixtures', '1', 'Красный Диван'),
  ('e1000000-0000-4000-8000-000000000002', 'fixtures', '2', 'Пикник-Сити');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status) values
  ('f1000000-0000-4000-8000-000000000001', 'fixtures', '1', 'c0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', '2026-11-10T15:00:00Z', 'SCHEDULED'),
  ('f1000000-0000-4000-8000-000000000002', 'fixtures', '2', 'c0000000-0000-4000-8000-000000000001',
   'e1000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', '2026-11-11T15:00:00Z', 'SCHEDULED');
insert into public.markets (id, match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli) values
  ('d1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2350, 3100, 2900),
  ('d1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000002', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2350, 3100, 2900);

-- ======================================================= прогнозы
select lives_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'HOME', 100, 2350, 235,
          'b1000000-0000-4000-8000-000000000001', 'h1')
$$, 'корректный прогноз принимается; 100 * 2.350 = 235 (floor)');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'HOME', 9, 2350, 21,
          'b1000000-0000-4000-8000-000000000009', 'h')
$$, '23514', null, 'ставка 9 меньше минимума 10');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'HOME', 1001, 2350, 2352,
          'b1000000-0000-4000-8000-000000000009', 'h')
$$, '23514', null, 'ставка 1001 больше максимума 1000');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'HOME', 100, 2350, 236,
          'b1000000-0000-4000-8000-000000000009', 'h')
$$, '23514', null, 'потенциальная выплата обязана совпадать с floor(stake * odds / 1000)');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'HOME', 100, 1000, 100,
          'b1000000-0000-4000-8000-000000000009', 'h')
$$, '23514', null, 'коэффициент 1.000 вне диапазона 1.10–12.00');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, actual_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'HOME', 100, 2350, 235, 0,
          'b1000000-0000-4000-8000-000000000009', 'h')
$$, '23514', null, 'PENDING не может иметь actual_payout');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000001', 'DRAW', 100, 3100, 310,
          'b1000000-0000-4000-8000-000000000002', 'h2')
$$, '23505', null, 'второй прогноз пользователя на тот же рынок запрещен');

select throws_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'DRAW', 100, 3100, 310,
          'b1000000-0000-4000-8000-000000000001', 'h3')
$$, '23505', null, 'idempotency key уникален в рамках пользователя');

select lives_ok($$
  update public.bets set status = 'WON', actual_payout = 235, settled_at = now()
  where idempotency_key = 'b1000000-0000-4000-8000-000000000001'
$$, 'PENDING -> WON с выплатой, равной potential_payout');

select throws_ok($$
  update public.bets set status = 'PENDING', actual_payout = null, settled_at = null
  where idempotency_key = 'b1000000-0000-4000-8000-000000000001'
$$, '55000', null, 'рассчитанный прогноз нельзя вернуть в PENDING');

select lives_ok($$
  insert into public.bets (user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout, idempotency_key, request_hash)
  values ('00000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000002', 'DRAW', 100, 3100, 310,
          'b1000000-0000-4000-8000-000000000002', 'h2')
$$, 'второй прогноз на другой рынок принимается');

select throws_ok($$
  update public.bets set stake = 200 where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, '55000', null, 'ставка принятого прогноза неизменяема');

select throws_ok($$
  delete from public.bets where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, '55000', null, 'прогнозы нельзя удалять');

select throws_ok($$
  update public.bets set status = 'WON', actual_payout = 1, settled_at = now()
  where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'WON с выплатой, не равной potential_payout, отклоняется');

select throws_ok($$
  update public.bets set status = 'LOST', actual_payout = 5, settled_at = now()
  where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'LOST обязан иметь actual_payout = 0');

select throws_ok($$
  update public.bets set status = 'VOID', actual_payout = 99, settled_at = now()
  where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'VOID обязан вернуть ровно ставку');

select lives_ok($$
  update public.bets set status = 'VOID', actual_payout = 100, settled_at = now()
  where idempotency_key = 'b1000000-0000-4000-8000-000000000002'
$$, 'PENDING -> VOID с возвратом ставки');

-- ======================================================= журнал и кошелек
select lives_ok($$
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'INITIAL_CREDIT', 10000, 'initial_credit:a')
$$, 'стартовый кредит записывается в журнал');

select lives_ok($$
  update public.wallets set balance = 10000 where user_id = '00000000-0000-4000-8000-00000000000a'
$$, 'баланс обновляется вместе с журналом');

select throws_ok($$
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'INITIAL_CREDIT', 10000, 'initial_credit:a-again')
$$, '23505', null, 'второй INITIAL_CREDIT одного пользователя запрещен даже с другим operation_key');

select throws_ok($$
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'ADMIN_ADJUSTMENT', 5, 'initial_credit:a')
$$, '23505', null, 'operation_key уникален');

select throws_ok($$
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'ADMIN_ADJUSTMENT', 0, 'zero')
$$, '23514', null, 'нулевая сумма записи журнала запрещена');

select throws_ok($$
  insert into public.wallet_entries (user_id, kind, amount, bet_id, operation_key)
  select user_id, 'STAKE_DEBIT'::public.wallet_entry_kind, 100, id, 'bad-sign' from public.bets limit 1
$$, '23514', null, 'STAKE_DEBIT должен быть отрицательным');

select throws_ok($$
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'STAKE_DEBIT', -100, 'no-bet')
$$, '23514', null, 'STAKE_DEBIT без bet_id запрещен');

select throws_ok($$
  update public.wallet_entries set amount = 1 where operation_key = 'initial_credit:a'
$$, '55000', null, 'журнал append-only: UPDATE запрещен');

select throws_ok($$
  delete from public.wallet_entries where operation_key = 'initial_credit:a'
$$, '55000', null, 'журнал append-only: DELETE запрещен');

select throws_ok($$
  update public.wallets set balance = -1 where user_id = '00000000-0000-4000-8000-00000000000a'
$$, '23514', null, 'отрицательный баланс запрещен');

create function pg_temp.unbalanced_entry() returns void language plpgsql as $f$
begin
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'ADMIN_ADJUSTMENT', 50, 'unbalanced');
  set constraints all immediate;
end;
$f$;

create function pg_temp.balanced_entry() returns void language plpgsql as $f$
begin
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-00000000000a', 'ADMIN_ADJUSTMENT', 50, 'balanced');
  update public.wallets set balance = balance + 50 where user_id = '00000000-0000-4000-8000-00000000000a';
  set constraints all immediate;
end;
$f$;

select throws_ok($$ select pg_temp.unbalanced_entry() $$, '23514', null,
  'запись журнала без обновления кошелька нарушает balance = SUM(журнала)');
select lives_ok($$ select pg_temp.balanced_entry() $$,
  'запись журнала вместе с обновлением кошелька проходит проверку');

-- ======================================================= рынки
select throws_ok($$
  update public.markets set status = 'RESOLVED', resolved_outcome = 'HOME', resolved_at = now()
  where id = 'd1000000-0000-4000-8000-000000000001'
$$, '55000', null, 'OPEN нельзя сразу разрешить: сначала CLOSED');

select lives_ok($$
  update public.markets set status = 'CLOSED' where id = 'd1000000-0000-4000-8000-000000000001'
$$, 'OPEN -> CLOSED');

select throws_ok($$
  update public.markets set status = 'RESOLVED' where id = 'd1000000-0000-4000-8000-000000000001'
$$, '23514', null, 'RESOLVED требует resolved_outcome и resolved_at');

select lives_ok($$
  update public.markets set status = 'RESOLVED', resolved_outcome = 'HOME', resolved_at = now()
  where id = 'd1000000-0000-4000-8000-000000000001'
$$, 'CLOSED -> RESOLVED с исходом');

select throws_ok($$
  update public.markets set status = 'OPEN', resolved_outcome = null, resolved_at = null
  where id = 'd1000000-0000-4000-8000-000000000001'
$$, '55000', null, 'RESOLVED не переоткрывается');

select throws_ok($$
  update public.markets set status = 'VOID' where id = 'd1000000-0000-4000-8000-000000000001'
$$, '55000', null, 'RESOLVED нельзя превратить в VOID');

select throws_ok($$
  update public.markets set home_odds_milli = 1000 where id = 'd1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'коэффициент рынка ниже 1.10 запрещен');

select throws_ok($$
  update public.markets set draw_odds_milli = 12001 where id = 'd1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'коэффициент рынка выше 12.00 запрещен');

select throws_ok($$
  insert into public.markets (match_id, type, model_version, home_odds_milli, draw_odds_milli, away_odds_milli)
  values ('f1000000-0000-4000-8000-000000000002', 'MATCH_RESULT_1X2', 'demo-v1', 2000, 2000, 2000)
$$, '23505', null, 'один рынок типа 1X2 на матч');

-- ======================================================= матчи
select throws_ok($$
  update public.matches set regulation_home_score = 1 where id = 'f1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'счет известен целиком или неизвестен: null не равен 0');

select throws_ok($$
  update public.matches set regulation_home_score = -1, regulation_away_score = 0
  where id = 'f1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'отрицательный счет запрещен');

select throws_ok($$
  update public.matches set away_team_id = home_team_id where id = 'f1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'команда не может играть сама с собой');

select throws_ok($$
  update public.matches set result_confirmed_at = now() where id = 'f1000000-0000-4000-8000-000000000002'
$$, '23514', null, 'подтверждение результата требует первого наблюдения');

select lives_ok($$
  update public.matches set regulation_home_score = 2, regulation_away_score = 1, status = 'FINISHED',
    result_kind = 'REGULAR', result_first_seen_at = now(), result_confirmed_at = now()
  where id = 'f1000000-0000-4000-8000-000000000002'
$$, 'корректный итог матча записывается');

select throws_ok($$
  update public.profiles set display_name = 'x<b>y' where id = '00000000-0000-4000-8000-00000000000a'
$$, '23514', null, 'имя с угловыми скобками запрещено ограничением профиля');

select * from finish();
rollback;
