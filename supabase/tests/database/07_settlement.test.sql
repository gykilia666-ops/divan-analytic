-- Подтверждение результата, расчет, возвраты, аренда, конфликт и ручной разбор (§9.4, §9.5, §10.4,
-- §10.6, §10.7). Этап 7. Свой поставщик pgtap-s.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ======================================================= данные: 5 матчей, рынки 2.00 / 3.00 / 4.00
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c7000000-0000-4000-8000-000000000001', 'pgtap-s', '1', 'ST', 'Лига расчета', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e7000000-0000-4000-8000-000000000001', 'pgtap-s', '1', 'Хозяева'),
  ('e7000000-0000-4000-8000-000000000002', 'pgtap-s', '2', 'Гости');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status, last_seen_at)
select ('f7000000-0000-4000-8000-00000000000' || n)::uuid, 'pgtap-s', 'm' || n,
       'c7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000001',
       'e7000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()
from generate_series(1, 5) n;
insert into public.markets (id, match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli)
select ('a7000000-0000-4000-8000-00000000000' || n)::uuid, ('f7000000-0000-4000-8000-00000000000' || n)::uuid,
       'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000
from generate_series(1, 5) n;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000007a1', 'a7@test.local', '{"user_name":"alice7"}'),
  ('00000000-0000-4000-8000-0000000007b1', 'b7@test.local', '{"user_name":"bobby7"}'),
  ('00000000-0000-4000-8000-0000000007c1', 'c7@test.local', '{"user_name":"carol7"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;
create function pg_temp.bet(p_market int, p_outcome text, p_stake int) returns void language plpgsql as $f$
declare v jsonb;
begin
  v := public.place_bet(('a7000000-0000-4000-8000-00000000000' || p_market)::uuid, p_outcome, p_stake, 1, gen_random_uuid());
  if not (v ->> 'ok')::boolean then raise exception 'bet failed: %', v; end if;
end;
$f$;
create function pg_temp.bal(p_uid text) returns bigint language sql as $f$
  select balance from public.wallets where user_id = p_uid::uuid
$f$;
create function pg_temp.ledger_ok(p_uid text) returns boolean language sql as $f$
  select (select balance from public.wallets where user_id = p_uid::uuid)
       = (select sum(amount) from public.wallet_entries where user_id = p_uid::uuid)
$f$;

do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000007a1'); perform public.ensure_user_initialized();
  perform pg_temp.bet(1, 'HOME', 100); perform pg_temp.bet(2, 'HOME', 200); perform pg_temp.bet(5, 'AWAY', 100); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000007b1'); perform public.ensure_user_initialized();
  perform pg_temp.bet(1, 'AWAY', 100); perform pg_temp.bet(3, 'HOME', 50); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000007c1'); perform public.ensure_user_initialized();
  perform pg_temp.bet(1, 'DRAW', 100); perform pg_temp.bet(4, 'HOME', 100); end $$;
reset role;

-- Итоги: m1 2:1 (хозяева), m2 отменен, m3 прерван 49 ч назад, m4 неоднозначный, m5 0:1 (не подтвердится).
update public.matches set kickoff_at = now() - interval '2 hours', status = 'FINISHED',
  regulation_home_score = 2, regulation_away_score = 1, result_kind = 'REGULAR' where provider_id = 'm1' and provider = 'pgtap-s';
update public.matches set status = 'CANCELLED' where provider_id = 'm2' and provider = 'pgtap-s';
update public.matches set kickoff_at = now() - interval '49 hours', status = 'SUSPENDED' where provider_id = 'm3' and provider = 'pgtap-s';
update public.matches set kickoff_at = now() - interval '2 hours', status = 'FINISHED', result_kind = 'AMBIGUOUS' where provider_id = 'm4' and provider = 'pgtap-s';
update public.matches set kickoff_at = now() - interval '2 hours', status = 'FINISHED',
  regulation_home_score = 0, regulation_away_score = 1, result_kind = 'REGULAR' where provider_id = 'm5' and provider = 'pgtap-s';
update public.markets set status = 'CLOSED' where id in ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000004', 'a7000000-0000-4000-8000-000000000005');
update public.markets set status = 'SUSPENDED' where id in ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003');

-- ======================================================= аренда
select is(public.job_acquire_lease('t-job', 'd7000000-0000-4000-8000-000000000001', 60), 1::bigint, 'аренда выдана, поколение 1');
select is(public.job_acquire_lease('t-job', 'd7000000-0000-4000-8000-000000000002', 60), null::bigint, 'занятая аренда второму не выдается');
update public.job_leases set lease_until = now() - interval '1 second' where job_name = 't-job';
select is(public.job_acquire_lease('t-job', 'd7000000-0000-4000-8000-000000000002', 60), 2::bigint, 'истекшая аренда восстанавливается: поколение 2');
select is(public.job_release_lease('t-job', 'd7000000-0000-4000-8000-000000000001', 1), false, 'устаревший владелец не освобождает чужую аренду');
select throws_ok($$ select public.job_assert_lease('t-job', 'd7000000-0000-4000-8000-000000000001', 1) $$, '55000', 'LEASE_LOST',
  'устаревшее поколение не проходит fencing');
select is(public.job_release_lease('t-job', 'd7000000-0000-4000-8000-000000000002', 2), true, 'владелец освобождает аренду');

-- ======================================================= подтверждение результата
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'observed', '3', 'первое наблюдение: m1, m2, m5 (m3 прерван, m4 неоднозначен)');
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'confirmed', '0', 'повтор сразу же не подтверждает итог');
select is((select count(*) from public.matches where provider = 'pgtap-s' and result_confirmed_at is not null), 0::bigint,
  'ничего не подтверждено без второго наблюдения через интервал');
update public.matches set result_first_seen_at = now() - interval '11 minutes'
  where provider = 'pgtap-s' and provider_id in ('m1', 'm2');
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'confirmed', '2', 'второе наблюдение через интервал подтверждает m1 и m2');

-- ======================================================= расчет под арендой
create temporary table lease_ctx as
  select 'd7000000-0000-4000-8000-0000000000aa'::uuid as owner,
         public.job_acquire_lease('sync', 'd7000000-0000-4000-8000-0000000000aa', 60) as gen;

select ok((select (public.settle_ready_markets('sync', owner, gen, 50) ->> 'resolved')::int >= 1 from lease_ctx),
  'пачка расчета выполнена');

select is((select array[status::text, resolved_outcome::text] from public.markets where id = 'a7000000-0000-4000-8000-000000000001'),
  array['RESOLVED', 'HOME'], 'm1 разрешен: победа хозяев');
select is(
  (select array_agg(u.email || ':' || b.status || ':' || b.actual_payout order by u.email)
   from public.bets b join auth.users u on u.id = b.user_id
   where b.market_id = 'a7000000-0000-4000-8000-000000000001'),
  array['a7@test.local:WON:200', 'b7@test.local:LOST:0', 'c7@test.local:LOST:0'],
  'выигрыш = принятый коэффициент × сумма; проигрыш — 0'
);
select is((select status::text from public.markets where id = 'a7000000-0000-4000-8000-000000000002'), 'VOID', 'отмененный матч: рынок аннулирован');
select is((select status::text from public.markets where id = 'a7000000-0000-4000-8000-000000000003'), 'VOID', 'прерван > 48 ч без итога: возврат');
select is((select status::text from public.bets where market_id = 'a7000000-0000-4000-8000-000000000004'), 'PENDING',
  'неоднозначный итог не рассчитывается догадкой');
select is((select status::text from public.bets where market_id = 'a7000000-0000-4000-8000-000000000005'), 'PENDING',
  'неподтвержденный итог не рассчитывается');

select is(pg_temp.bal('00000000-0000-4000-8000-0000000007a1'), 10000::bigint, 'A: −100 −200 −100 +200 выигрыш +200 возврат');
select is(pg_temp.bal('00000000-0000-4000-8000-0000000007b1'), 9900::bigint, 'B: −100 −50 +50 возврат');
select is(pg_temp.bal('00000000-0000-4000-8000-0000000007c1'), 9800::bigint, 'C: −100 −100');
select ok(pg_temp.ledger_ok('00000000-0000-4000-8000-0000000007a1') and pg_temp.ledger_ok('00000000-0000-4000-8000-0000000007b1')
  and pg_temp.ledger_ok('00000000-0000-4000-8000-0000000007c1'), 'баланс = сумма журнала у всех');
select is((select operation_key from public.wallet_entries e join public.bets b on b.id = e.bet_id
           where e.kind = 'WIN_CREDIT' and b.market_id = 'a7000000-0000-4000-8000-000000000001'),
  'win:' || (select id from public.bets where market_id = 'a7000000-0000-4000-8000-000000000001' and status = 'WON')::text,
  'начисление выигрыша с детерминированным operation_key');

-- Повторный расчет — no-op.
select lives_ok($$ select public.settle_ready_markets('sync', owner, gen, 50) from lease_ctx $$, 'повторный расчет выполняется без ошибок');
select is((select count(*) from public.wallet_entries e join public.bets b on b.id = e.bet_id
           where b.market_id in ('a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002',
                                 'a7000000-0000-4000-8000-000000000003') and e.kind in ('WIN_CREDIT', 'VOID_REFUND')),
  3::bigint, 'повторный расчет не начисляет снова');
select is(pg_temp.bal('00000000-0000-4000-8000-0000000007a1'), 10000::bigint, 'баланс A не изменился после повтора');

-- Fencing: устаревший исполнитель не пишет.
select throws_ok($$ select public.settle_ready_markets('sync', 'd7000000-0000-4000-8000-0000000000bb', 999, 50) $$, '55000', 'LEASE_LOST',
  'чужая или устаревшая аренда — расчет не выполняется');
update public.job_leases set lease_until = now() - interval '1 second' where job_name = 'sync';
select throws_ok($$ select public.settle_ready_markets('sync', owner, gen, 50) from lease_ctx $$, '55000', 'LEASE_LOST',
  'истекшая аренда — расчет не выполняется');

-- ======================================================= изменение итога после расчета (§9.5)
update public.matches set regulation_home_score = 1, regulation_away_score = 1
  where provider = 'pgtap-s' and provider_id = 'm1';
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'conflicts', '1', 'итог изменился после расчета — конфликт');
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'conflicts', '0', 'конфликт фиксируется один раз');
select is((select count(*) from public.audit_events where kind = 'RESULT_CHANGED_AFTER_SETTLEMENT'
           and match_id = 'f7000000-0000-4000-8000-000000000001'), 1::bigint, 'одна запись аудита');
select is((select status::text from public.bets where market_id = 'a7000000-0000-4000-8000-000000000001'
           and user_id = '00000000-0000-4000-8000-0000000007a1'), 'WON', 'рассчитанные прогнозы не перезаписываются');
select is(pg_temp.bal('00000000-0000-4000-8000-0000000007a1'), 10000::bigint, 'баланс не меняется автоматически');

-- После VOID (отмена) изменения матча не считаются конфликтом: ставки уже возвращены.
update public.matches set status = 'SCHEDULED', kickoff_at = now() + interval '3 days'
  where provider = 'pgtap-s' and provider_id = 'm2';
select is(public.sync_confirm_results('pgtap-s', 600) ->> 'conflicts', '0', 'перенос после возврата — не конфликт');

-- Ручной разбор.
select lives_ok($$ select public.admin_ack_result_conflict('f7000000-0000-4000-8000-000000000001', 'проверено вручную') $$,
  'конфликт подтвержден после ручной проверки');
select is((select result_conflict_at from public.matches where id = 'f7000000-0000-4000-8000-000000000001'), null::timestamptz,
  'пауза снята');
select is(public.admin_compensate('00000000-0000-4000-8000-0000000007b1', 50, 'компенсация после конфликта', 'conf-m1-b'), 9950::bigint,
  'компенсация — новая запись журнала');
select ok(pg_temp.ledger_ok('00000000-0000-4000-8000-0000000007b1'), 'после компенсации баланс = журнал');
select throws_ok($$ select public.admin_compensate('00000000-0000-4000-8000-0000000007c1', -100000, 'слишком большое списание', 'neg') $$,
  '23514', 'NEGATIVE_BALANCE', 'компенсация не уводит баланс в минус');
select throws_ok($$ select public.admin_compensate('00000000-0000-4000-8000-0000000007b1', 50, 'повтор той же операции', 'conf-m1-b') $$,
  '23505', null, 'ключ операции компенсации уникален');

-- ======================================================= очистка
insert into public.rate_limit_buckets values ('old:x', now() - interval '2 days', 1);
insert into public.job_runs (job_name, started_at) values ('sync', now() - interval '31 days');
select ok((select (public.job_cleanup() ->> 'rateLimitBuckets')::int >= 1), 'старые счетчики удаляются');
select is((select count(*) from public.job_runs where started_at < now() - interval '30 days'), 0::bigint, 'старые запуски удаляются');

-- ======================================================= права
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000007a1'); end $$;
select throws_ok($$ select public.settle_ready_markets('sync', gen_random_uuid(), 1, 1) $$, '42501', null, 'пользователь не запускает расчет');
select throws_ok($$ select public.sync_confirm_results('pgtap-s', 600) $$, '42501', null, 'пользователь не подтверждает итоги');
select throws_ok($$ select public.job_acquire_lease('sync', gen_random_uuid(), 60) $$, '42501', null, 'пользователь не берет аренду');
select throws_ok($$ select public.admin_compensate('00000000-0000-4000-8000-0000000007a1', 1000, 'хочу монет', 'x') $$, '42501', null,
  'пользователь не начисляет себе монеты');
select throws_ok($$ select * from public.audit_events $$, '42501', null, 'пользователь не читает аудит');
reset role;

set local role service_role;
select throws_ok($$ select public.settle_market('a7000000-0000-4000-8000-000000000004') $$, '42501', null,
  'даже service_role не рассчитывает рынок в обход аренды');
reset role;

select * from finish();
rollback;
