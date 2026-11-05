-- Прием прогноза (CLAUDE.md §6.7, §9.1–9.2, §13.5). Этап 6. Свой поставщик pgtap-b.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ======================================================= данные
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c6000000-0000-4000-8000-000000000001', 'pgtap-b', '1', 'BT', 'Лига ставок', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e6000000-0000-4000-8000-000000000001', 'pgtap-b', '1', 'Хозяева'),
  ('e6000000-0000-4000-8000-000000000002', 'pgtap-b', '2', 'Гости');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status, last_seen_at) values
  ('f6000000-0000-4000-8000-000000000001', 'pgtap-b', 'm1', 'c6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()),
  ('f6000000-0000-4000-8000-000000000002', 'pgtap-b', 'm2', 'c6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()),
  ('f6000000-0000-4000-8000-000000000003', 'pgtap-b', 'm3', 'c6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()),
  ('f6000000-0000-4000-8000-000000000004', 'pgtap-b', 'm4', 'c6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', now() + interval '3 minutes', 'SCHEDULED', now()),
  ('f6000000-0000-4000-8000-000000000005', 'pgtap-b', 'm5', 'c6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000001', 'e6000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now() - interval '2 hours');
insert into public.markets (id, match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli) values
  ('a6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000001', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2350, 3100, 2900),
  ('a6000000-0000-4000-8000-000000000002', 'f6000000-0000-4000-8000-000000000002', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 1999, 3333, 4001),
  ('a6000000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-000000000003', 'MATCH_RESULT_1X2', 'CLOSED', 1, 'demo-v1', 2000, 3000, 4000),
  ('a6000000-0000-4000-8000-000000000004', 'f6000000-0000-4000-8000-000000000004', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000),
  ('a6000000-0000-4000-8000-000000000005', 'f6000000-0000-4000-8000-000000000005', 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000006a1', 'a6@test.local', '{"user_name":"alice6"}'),
  ('00000000-0000-4000-8000-0000000006b1', 'b6@test.local', '{"user_name":"bobby6"}'),
  ('00000000-0000-4000-8000-0000000006c1', 'c6@test.local', '{"user_name":"carol6"}'),
  ('00000000-0000-4000-8000-0000000006d1', 'd6@test.local', '{"user_name":"david6"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;

do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006a1'); end $$;
do $$ begin perform public.set_pseudonym('Alice Six'); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006b1'); end $$;
do $$ begin perform public.set_pseudonym('Bobby Six'); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006c1'); end $$;
do $$ begin perform public.set_pseudonym('Carol Six'); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006d1'); end $$;
do $$ begin perform public.set_pseudonym('David Six'); end $$;
reset role;

create function pg_temp.spam() returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  for i in 1..10 loop
    v := public.place_bet('a6000000-0000-4000-8000-0000000000ff', 'HOME', 100, 1, gen_random_uuid());
  end loop;
  return public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000d1');
end;
$f$;

create temporary table r (name text primary key, res jsonb);
grant all on r to authenticated;

-- ======================================================= пользователь A: успешный прогноз и повторы
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006a1'); end $$;
insert into r values ('first', public.place_bet('a6000000-0000-4000-8000-000000000001', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000001'));
insert into r values ('replay', public.place_bet('a6000000-0000-4000-8000-000000000001', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000001'));
insert into r values ('conflict', public.place_bet('a6000000-0000-4000-8000-000000000001', 'HOME', 200, 1, 'b6000000-0000-4000-8000-000000000001'));
insert into r values ('second_on_market', public.place_bet('a6000000-0000-4000-8000-000000000001', 'DRAW', 100, 1, 'b6000000-0000-4000-8000-000000000002'));
insert into r values ('stake_low', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 9, 1, 'b6000000-0000-4000-8000-000000000003'));
insert into r values ('stake_high', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 1001, 1, 'b6000000-0000-4000-8000-000000000003'));
insert into r values ('bad_outcome', public.place_bet('a6000000-0000-4000-8000-000000000002', 'X', 100, 1, 'b6000000-0000-4000-8000-000000000003'));
insert into r values ('quote', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 2, 'b6000000-0000-4000-8000-000000000004'));
insert into r values ('closed', public.place_bet('a6000000-0000-4000-8000-000000000003', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000005'));
insert into r values ('cutoff', public.place_bet('a6000000-0000-4000-8000-000000000004', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000006'));
insert into r values ('stale', public.place_bet('a6000000-0000-4000-8000-000000000005', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000007'));
insert into r values ('missing', public.place_bet('a6000000-0000-4000-8000-0000000000ff', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000008'));
reset role;

select is((select res ->> 'ok' from r where name = 'first'), 'true', 'прогноз принят');
select is((select (res -> 'bet' ->> 'potentialPayout')::int from r where name = 'first'), 235,
  'выплата = floor(100 × 2.350) и включает сумму прогноза');
select is((select (res ->> 'balance')::int from r where name = 'first'), 9900, 'баланс уменьшен на сумму');
select is((select res ->> 'replay' from r where name = 'first'), 'false', 'первый вызов — не повтор');

select is((select res ->> 'replay' from r where name = 'replay'), 'true', 'повтор того же ключа узнан');
select is((select res -> 'bet' ->> 'id' from r where name = 'replay'),
          (select res -> 'bet' ->> 'id' from r where name = 'first'),
  'повтор возвращает исходный прогноз');
select is((select res ->> 'code' from r where name = 'conflict'), 'IDEMPOTENCY_CONFLICT',
  'тот же ключ с другим содержимым — конфликт');
select is((select res ->> 'code' from r where name = 'second_on_market'), 'ALREADY_PLACED',
  'второй прогноз на тот же рынок запрещен');
select is((select res ->> 'code' from r where name = 'stake_low'), 'VALIDATION_ERROR', 'сумма 9 отклонена');
select is((select res ->> 'code' from r where name = 'stake_high'), 'VALIDATION_ERROR', 'сумма 1001 отклонена');
select is((select res ->> 'code' from r where name = 'bad_outcome'), 'VALIDATION_ERROR', 'неизвестный исход отклонен');
select is((select res ->> 'code' from r where name = 'quote'), 'QUOTE_CHANGED', 'устаревшая котировка');
select is((select (res -> 'details' ->> 'quoteVersion')::int from r where name = 'quote'), 1,
  'ответ сообщает актуальную версию котировки');
select is((select res ->> 'code' from r where name = 'closed'), 'MARKET_CLOSED', 'закрытый рынок');
select is((select res ->> 'code' from r where name = 'cutoff'), 'MARKET_CLOSED',
  'рынок еще OPEN, но до старта 3 минуты — время закрывает прием');
select is((select res ->> 'code' from r where name = 'stale'), 'DATA_STALE', 'устаревшие данные');
select is((select res ->> 'code' from r where name = 'missing'), 'NOT_FOUND', 'несуществующий рынок');

select is((select count(*) from public.bets where user_id = '00000000-0000-4000-8000-0000000006a1'), 1::bigint,
  'у пользователя ровно один прогноз');
select is((select count(*) from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000006a1' and kind = 'STAKE_DEBIT'),
  1::bigint, 'ровно одно списание, повторы не списывают снова');
select is((select balance from public.wallets where user_id = '00000000-0000-4000-8000-0000000006a1'),
  (select sum(amount)::bigint from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000006a1'),
  'баланс = сумма журнала');
select is((select accepted_odds_milli from public.bets where user_id = '00000000-0000-4000-8000-0000000006a1'), 2350,
  'коэффициент берется из БД, а не от клиента');

-- Повтор после закрытия рынка возвращает исходный результат.
update public.markets set status = 'CLOSED' where id = 'a6000000-0000-4000-8000-000000000001';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006a1'); end $$;
insert into r values ('replay_closed', public.place_bet('a6000000-0000-4000-8000-000000000001', 'HOME', 100, 1, 'b6000000-0000-4000-8000-000000000001'));
reset role;
select is((select res ->> 'replay' from r where name = 'replay_closed'), 'true',
  'повтор после закрытия рынка — исходный успешный результат');

-- ======================================================= пользователь B: баланс
insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values ('00000000-0000-4000-8000-0000000006b1', 'ADMIN_ADJUSTMENT', -9950, 'test:b-adjust');
update public.wallets set balance = 50 where user_id = '00000000-0000-4000-8000-0000000006b1';

do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006b1'); end $$;
insert into r values ('b_insufficient', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000b1'));
insert into r values ('b_all_in', public.place_bet('a6000000-0000-4000-8000-000000000002', 'AWAY', 50, 1, 'b6000000-0000-4000-8000-0000000000b2'));
insert into r values ('b_list', (select jsonb_agg(h.id) from public.list_my_bets() h));
reset role;
select is((select res ->> 'code' from r where name = 'b_insufficient'), 'INSUFFICIENT_BALANCE', 'сумма больше баланса');
select is((select array[(res ->> 'balance')::int, (res -> 'bet' ->> 'potentialPayout')::int] from r where name = 'b_all_in'),
  array[0, 200], 'ставка на весь баланс: баланс 0, выплата floor(50 × 4.001) = 200');
select is((select jsonb_array_length(res) from r where name = 'b_list'), 1, 'история B содержит только его прогноз');

-- ======================================================= аккаунт и права
update public.profiles set disabled_at = now() where id = '00000000-0000-4000-8000-0000000006c1';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006c1'); end $$;
insert into r values ('disabled', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000c1'));
reset role;
select is((select res ->> 'code' from r where name = 'disabled'), 'ACCOUNT_DISABLED', 'отключенный аккаунт');

set local role authenticated;
set local request.jwt.claims = '{}';
insert into r values ('anon_claims', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000e1'));
reset role;
select is((select res ->> 'code' from r where name = 'anon_claims'), 'UNAUTHENTICATED', 'без пользователя в токене');

set local role anon;
select throws_ok($$ select public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000e2') $$,
  '42501', null, 'гость не вызывает place_bet');
select throws_ok($$ select * from public.list_my_bets() $$, '42501', null, 'гость не читает историю');
reset role;

do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006a1'); end $$;
select throws_ok($$ select public.rate_limit_hit('x', 1, 60) $$, '42501', null,
  'пользователь не вызывает служебный счетчик');
select throws_ok($$ select * from public.rate_limit_buckets $$, '42501', null,
  'пользователь не читает счетчики');
select is((select count(*) from public.bet_history), 1::bigint, 'история A: только свой прогноз');
reset role;

-- ======================================================= лимит частоты
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006d1'); end $$;

insert into r values ('rate', pg_temp.spam());
reset role;
select is((select res ->> 'code' from r where name = 'rate'), 'RATE_LIMITED',
  '11-я попытка за минуту отклонена — лимит действует и при прямом вызове RPC');
select is((select count(*) from public.bets where user_id = '00000000-0000-4000-8000-0000000006d1'), 0::bigint,
  'после отказа по лимиту прогноз не создан');

-- ======================================================= игрок без псевдонима (ADR-074)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000006e1', 'e6@test.local', '{}');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006e1'); end $$;
insert into r values ('no_name', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000f1'));
-- Повтор с тем же ключом даёт тот же отказ.
insert into r values ('no_name_repeat', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000f1'));
reset role;
select is((select res ->> 'code' from r where name = 'no_name'), 'PSEUDONYM_REQUIRED', 'без псевдонима прогноз не принимается');
select is((select res ->> 'code' from r where name = 'no_name_repeat'), 'PSEUDONYM_REQUIRED', 'повторная попытка с тем же ключом тоже отклонена');
select is((select count(*) from public.bets where user_id = '00000000-0000-4000-8000-0000000006e1'), 0::bigint,
  'прогноз без псевдонима не создан');
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000006e1')
        + (select count(*) from public.wallets where user_id = '00000000-0000-4000-8000-0000000006e1')
        + (select count(*) from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000006e1'),
  0::bigint, 'отказ не создал ни профиля, ни кошелька, ни журнала (ADR-075)');
select is((select count(*) from public.rate_limit_buckets where bucket_key = 'place_bet:00000000-0000-4000-8000-0000000006e1'),
  0::bigint, 'отказ из-за псевдонима не расходует лимит частоты');

-- После выбора псевдонима тот же игрок делает прогноз.
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006e1'); end $$;
select is((public.set_pseudonym('Новичок Шесть') ->> 'ok')::boolean, true, 'псевдоним выбран');
insert into r values ('named', public.place_bet('a6000000-0000-4000-8000-000000000002', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000f2'));
reset role;
select is((select res ->> 'ok' from r where name = 'named'), 'true', 'с псевдонимом прогноз принят');
select is((select count(*) from public.bets where user_id = '00000000-0000-4000-8000-0000000006e1'), 1::bigint,
  'прогноз создан после выбора псевдонима');
select is((select balance from public.wallets where user_id = '00000000-0000-4000-8000-0000000006e1'), 9900::bigint,
  'выбор псевдонима создал кошелек с 10000 монет, прогноз списал 100');

-- Оператор сбросил имя: прогнозы снова закрыты.
update public.profiles set display_name = null where id = '00000000-0000-4000-8000-0000000006e1';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000006e1'); end $$;
insert into r values ('after_reset', public.place_bet('a6000000-0000-4000-8000-000000000001', 'HOME', 100, 1, 'b6000000-0000-4000-8000-0000000000f3'));
reset role;
select is((select res ->> 'code' from r where name = 'after_reset'), 'PSEUDONYM_REQUIRED', 'после сброса имени прогнозы закрыты');

select * from finish();
rollback;
