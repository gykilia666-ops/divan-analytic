-- Админ-диагностика (§6.1, §13.1, этап 9): роль только из user_roles, причины ожидания расчета,
-- ручной запуск с лимитом, снятие конфликта, отказ обычному пользователю и гостю. Поставщик pgtap-ad.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000009a1', 'a9@test.local', '{"user_name":"admin9"}'),
  ('00000000-0000-4000-8000-0000000009b1', 'b9@test.local', '{"user_name":"user9"}'),
  ('00000000-0000-4000-8000-0000000009c1', 'c9@test.local', '{"user_name":"gone9"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009a1'); perform public.set_pseudonym('Игрок 9a1'); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009b1'); perform public.set_pseudonym('Игрок 9b1'); end $$;
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009c1'); perform public.set_pseudonym('Игрок 9c1'); end $$;
reset role;
insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-8000-0000000009a1', 'ADMIN'),
  ('00000000-0000-4000-8000-0000000009c1', 'ADMIN');
update public.profiles set disabled_at = now() where id = '00000000-0000-4000-8000-0000000009c1';

-- ======================================================= матчи на каждую причину ожидания
insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('c9000000-0000-4000-8000-000000000001', 'pgtap-ad', '1', 'AD', 'Лига диагностики', true);
insert into public.teams (id, provider, provider_id, name) values
  ('e9000000-0000-4000-8000-000000000001', 'pgtap-ad', '1', 'Хозяева'),
  ('e9000000-0000-4000-8000-000000000002', 'pgtap-ad', '2', 'Гости');

insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status,
  regulation_home_score, regulation_away_score, result_kind, result_first_seen_at, result_confirmed_at, result_conflict_at, last_seen_at)
select ('f9000000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'pgtap-ad', v.pid,
       'c9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-000000000002',
       now() + v.kick, v.status::public.match_status, v.h, v.a, v.kind::public.match_result_kind,
       now() + v.seen, now() + v.conf, now() + v.confl, now() + v.last
from (values
  (1,  'm01-live',      interval '-1 hour',   'LIVE',      null::int, null::int, 'NONE',      null::interval, null::interval, null::interval, interval '0'),
  (2,  'm02-unconf',    interval '-3 hours',  'FINISHED',  1,  0,  'REGULAR',   interval '0',          null,              null,           interval '0'),
  (3,  'm03-ready',     interval '-3 hours',  'FINISHED',  2,  2,  'REGULAR',   interval '-11 minutes', interval '0',     null,           interval '0'),
  (4,  'm04-ambig',     interval '-3 hours',  'FINISHED',  null, null, 'AMBIGUOUS', null,             null,              null,           interval '0'),
  (5,  'm05-susp',      interval '-2 hours',  'SUSPENDED', null, null, 'NONE',      null,             null,              null,           interval '0'),
  (6,  'm06-susp49',    interval '-49 hours', 'SUSPENDED', null, null, 'NONE',      null,             null,              null,           interval '0'),
  (7,  'm07-conflict',  interval '-5 hours',  'FINISHED',  1,  1,  'REGULAR',   interval '-2 hours',   interval '-1 hour', interval '0',  interval '0'),
  (8,  'm08-future',    interval '1 day',     'SCHEDULED', null, null, 'NONE',      null,             null,              null,           interval '0'),
  (9,  'm09-open',      interval '-10 minutes', 'SCHEDULED', null, null, 'NONE',    null,             null,              null,           interval '0'),
  (10, 'm10-noscore',   interval '-3 hours',  'FINISHED',  null, null, 'REGULAR',   null,             null,              null,           interval '0'),
  (11, 'm11-stale',     interval '1 day',     'SCHEDULED', null, null, 'NONE',      null,             null,              null,           interval '-2 hours')
) as v(n, pid, kick, status, h, a, kind, seen, conf, confl, last);

insert into public.markets (match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli,
  resolved_outcome, resolved_at)
select m.id, 'MATCH_RESULT_1X2',
       (case m.provider_id
          when 'm05-susp' then 'SUSPENDED' when 'm06-susp49' then 'SUSPENDED'
          when 'm07-conflict' then 'RESOLVED'
          when 'm08-future' then 'OPEN' when 'm09-open' then 'OPEN' when 'm11-stale' then 'OPEN'
          else 'CLOSED' end)::public.market_status,
       1, 'demo-v1', 2000, 3000, 4000,
       case when m.provider_id = 'm07-conflict' then 'HOME'::public.bet_outcome end,
       case when m.provider_id = 'm07-conflict' then now() end
from public.matches m where m.provider = 'pgtap-ad';

-- Запуски задания (в будущем относительно чужих записей, чтобы быть «последними»).
insert into public.job_runs (job_name, lease_generation, status, started_at, finished_at, summary, error_code) values
  ('sync', 41, 'OK', now() + interval '1 hour', now() + interval '1 hour', '{"sync":{"status":"ok","requests":3},"settlement":{"resolved":2,"void":1},"errors":[]}', null),
  ('sync', 42, 'PARTIAL', now() + interval '2 hours', now() + interval '2 hours',
   '{"sync":{"status":"partial","requests":2},"errors":[{"step":"sync","message":"TIMEOUT"}]}', null);

-- ======================================================= роль
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009a1'); end $$;
select is(public.is_admin(), true, 'администратор определяется по user_roles');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009b1'); end $$;
select is(public.is_admin(), false, 'обычный пользователь — не администратор');
select throws_ok($$ select public.admin_overview('pgtap-ad') $$, '42501', 'FORBIDDEN', 'обычный пользователь не видит обзор');
select throws_ok($$ select * from public.admin_pending_settlements('pgtap-ad') $$, '42501', 'FORBIDDEN',
  'обычный пользователь не видит очередь расчета');
select throws_ok($$ select public.admin_request_sync() $$, '42501', 'FORBIDDEN', 'обычный пользователь не запускает задание');
select throws_ok($$ select public.admin_resolve_conflict('f9000000-0000-4000-8000-000000000007', 'чужая попытка') $$,
  '42501', 'FORBIDDEN', 'обычный пользователь не снимает конфликт');
select throws_ok($$ select * from public.user_roles $$, '42501', null, 'роли не читаются клиентом');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009c1'); end $$;
select is(public.is_admin(), false, 'отключенный профиль теряет права администратора');
reset role;
set local role anon;
select throws_ok($$ select public.is_admin() $$, '42501', null, 'гость не вызывает is_admin');
select throws_ok($$ select public.admin_overview('pgtap-ad') $$, '42501', null, 'гость не вызывает admin_overview');
reset role;

-- ======================================================= обзор и очередь (администратор)
create temporary table seen_overview (o jsonb);
create temporary table seen_pending (provider_id text, reason text, pending_bets bigint);
grant insert on seen_overview, seen_pending to authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-0000000009a1');
  insert into seen_overview select public.admin_overview('pgtap-ad');
  insert into seen_pending
    select m.provider_id, p.reason, p.pending_bets
    from public.admin_pending_settlements('pgtap-ad', 200) p
    join public.matches m on m.id = p.match_id;
end $$;
reset role;

select is((select (o ->> 'staleMatches')::int from seen_overview), 1, 'устаревшие данные: один матч');
select is((select (o ->> 'conflicts')::int from seen_overview), 1, 'конфликтов: один');
select is((select o ->> 'lastSuccessAt' from seen_overview)::timestamptz, now() + interval '1 hour', 'последний успех');
select is((select o -> 'lastFailure' ->> 'status' from seen_overview), 'PARTIAL', 'последняя ошибка — частичный запуск');
select is((select o -> 'lastFailure' -> 'errors' -> 0 ->> 'message' from seen_overview), 'TIMEOUT', 'причина ошибки видна');
select is((select (o -> 'runs' -> 0 ->> 'generation')::int from seen_overview), 42, 'запуски — от новых к старым');
select is((select (o -> 'runs' -> 1 ->> 'settled')::int from seen_overview), 3, 'рассчитано = разрешено + аннулировано');
select ok((select (o ->> 'requests24h')::int >= 5 from seen_overview), 'запросы к поставщику за сутки суммируются');

select results_eq(
  $$ select provider_id, reason from seen_pending order by provider_id $$,
  $$ values ('m01-live'::text, 'NOT_FINISHED'::text),
            ('m02-unconf', 'AWAITING_CONFIRMATION'),
            ('m03-ready', 'READY'),
            ('m04-ambig', 'AMBIGUOUS_RESULT'),
            ('m05-susp', 'SUSPENDED_WAIT'),
            ('m06-susp49', 'READY'),
            ('m07-conflict', 'RESULT_CONFLICT'),
            ('m09-open', 'MARKET_NOT_CLOSED'),
            ('m10-noscore', 'NO_RESULT_DATA') $$,
  'каждый нерассчитанный рынок объяснен; будущие и рассчитанные без конфликта не в очереди'
);

-- Причины совпадают с поведением settle_market: READY рассчитывается, остальные — нет.
select is(public.settle_market((select k.id from public.markets k join public.matches m on m.id = k.match_id
  where m.provider_id = 'm03-ready' and m.provider = 'pgtap-ad')), 'RESOLVED', 'READY (подтвержден) — рассчитывается');
select is(public.settle_market((select k.id from public.markets k join public.matches m on m.id = k.match_id
  where m.provider_id = 'm06-susp49' and m.provider = 'pgtap-ad')), 'VOID', 'READY (прерван > 48 ч) — возврат');
select is(public.settle_market((select k.id from public.markets k join public.matches m on m.id = k.match_id
  where m.provider_id = 'm02-unconf' and m.provider = 'pgtap-ad')), 'SKIPPED', 'AWAITING_CONFIRMATION — не рассчитывается');
select is(public.settle_market((select k.id from public.markets k join public.matches m on m.id = k.match_id
  where m.provider_id = 'm04-ambig' and m.provider = 'pgtap-ad')), 'SKIPPED', 'AMBIGUOUS_RESULT — не рассчитывается');
select is(public.settle_market((select k.id from public.markets k join public.matches m on m.id = k.match_id
  where m.provider_id = 'm10-noscore' and m.provider = 'pgtap-ad')), 'SKIPPED', 'NO_RESULT_DATA — не рассчитывается');

-- ======================================================= действия администратора
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-0000000009a1'); end $$;
select is(public.admin_request_sync() ->> 'ok', 'true', 'ручной запуск разрешен');
select is(public.admin_request_sync() ->> 'code', 'RATE_LIMITED', 'повтор в течение минуты — RATE_LIMITED');
select throws_ok($$ select public.admin_resolve_conflict('f9000000-0000-4000-8000-000000000007', 'ой') $$,
  '22023', 'INVALID_ARGUMENTS', 'причина короче 5 символов отклоняется');
select lives_ok($$ select public.admin_resolve_conflict('f9000000-0000-4000-8000-000000000007', 'сверено с протоколом матча') $$,
  'администратор снимает конфликт');
select throws_ok($$ select public.admin_resolve_conflict('f9000000-0000-4000-8000-000000000007', 'повторное снятие') $$,
  '22023', 'NO_CONFLICT', 'повторное снятие — нет конфликта');
reset role;

select is((select count(*) from public.audit_events where kind = 'ADMIN_SYNC_REQUESTED'
           and user_id = '00000000-0000-4000-8000-0000000009a1'), 1::bigint, 'ручной запуск записан в аудит один раз');
select is((select count(*) from public.audit_events where kind = 'ADMIN_CONFLICT_RESOLVED'
           and user_id = '00000000-0000-4000-8000-0000000009a1'
           and match_id = 'f9000000-0000-4000-8000-000000000007'), 1::bigint, 'снятие конфликта записано с автором');
select ok((select result_conflict_at is null and result_confirmed_at is not null from public.matches
           where id = 'f9000000-0000-4000-8000-000000000007'), 'итог принят, пауза снята');

-- ======================================================= права
select ok(not has_function_privilege('authenticated', 'public.admin_assert()', 'execute'), 'admin_assert — внутренняя');
select ok(not has_function_privilege('authenticated',
  'public.settlement_wait_reason(public.market_status, public.match_status, public.match_result_kind, boolean, timestamptz, timestamptz, timestamptz, timestamptz)',
  'execute'), 'settlement_wait_reason — внутренняя');
select ok(not has_function_privilege('anon', 'public.admin_pending_settlements(text, integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_request_sync()', 'execute')
  and not has_function_privilege('anon', 'public.admin_resolve_conflict(uuid, text)', 'execute'),
  'гостю админ-функции не выданы');
select ok(not has_function_privilege('authenticated', 'public.admin_ack_result_conflict(uuid, text)', 'execute'),
  'прямое снятие конфликта (без проверки роли) пользователю недоступно');

select * from finish();
rollback;
