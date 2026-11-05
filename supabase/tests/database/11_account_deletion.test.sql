-- Удаление аккаунта (§8.4, ADR-061): обезличивание и отключение без удаления журнала. Этап 11.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.competitions (id, provider, provider_id, code, name, enabled) values
  ('cb000000-0000-4000-8000-000000000001', 'pgtap-del', '1', 'DL', 'Лига удаления', true);
insert into public.teams (id, provider, provider_id, name) values
  ('eb000000-0000-4000-8000-000000000001', 'pgtap-del', '1', 'Хозяева'),
  ('eb000000-0000-4000-8000-000000000002', 'pgtap-del', '2', 'Гости');
insert into public.matches (id, provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status, last_seen_at)
select ('fb000000-0000-4000-8000-00000000000' || n)::uuid, 'pgtap-del', 'm' || n,
       'cb000000-0000-4000-8000-000000000001', 'eb000000-0000-4000-8000-000000000001',
       'eb000000-0000-4000-8000-000000000002', now() + interval '2 days', 'SCHEDULED', now()
from generate_series(1, 2) n;
insert into public.markets (id, match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli)
select ('ab000000-0000-4000-8000-00000000000' || n)::uuid, ('fb000000-0000-4000-8000-00000000000' || n)::uuid,
       'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000
from generate_series(1, 2) n;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000bd1', 'del@test.local', '{"user_name":"leaving_user","avatar_url":"https://avatars.githubusercontent.com/u/1"}'),
  ('00000000-0000-4000-8000-000000000bd2', 'stay@test.local', '{"user_name":"staying_user"}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;

do $$ declare v jsonb; begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000bd1');
  perform public.ensure_user_initialized();
  v := public.place_bet('ab000000-0000-4000-8000-000000000001', 'HOME', 100, 1, gen_random_uuid());
  if not (v ->> 'ok')::boolean then raise exception 'bet failed: %', v; end if;
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000bd2');
  perform public.ensure_user_initialized();
end $$;
reset role;
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000bd1', 'ADMIN');

-- ======================================================= удаление
create temporary table del_result (r jsonb);
grant insert on del_result to authenticated;
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000bd1');
  insert into del_result select public.delete_my_account();
  insert into del_result select public.delete_my_account();
end $$;
reset role;

select is((select array_agg(r ->> 'alreadyDeleted' order by r ->> 'alreadyDeleted') from del_result),
  array['false', 'true'], 'удаление выполнено; повтор — без ошибок (идемпотентно)');
select is((select array[display_name, coalesce(avatar_url, 'null')] from public.profiles
           where id = '00000000-0000-4000-8000-000000000bd1'),
  array['Удалённый игрок', 'null'], 'имя и аватар обезличены');
select ok((select deleted_at is not null and disabled_at is not null from public.profiles
           where id = '00000000-0000-4000-8000-000000000bd1'), 'профиль помечен удаленным и отключен');
select is((select count(*) from public.user_roles where user_id = '00000000-0000-4000-8000-000000000bd1'),
  0::bigint, 'роли сняты');
select is((select count(*) from public.audit_events where kind = 'ACCOUNT_DELETED'
           and user_id = '00000000-0000-4000-8000-000000000bd1'), 1::bigint, 'удаление записано в аудит один раз');

-- Журнал и прогнозы сохранены, инвариант баланса не нарушен.
select is((select count(*) from public.bets where user_id = '00000000-0000-4000-8000-000000000bd1'), 1::bigint,
  'прогноз остается (журнал не удаляется)');
select ok((select balance from public.wallets where user_id = '00000000-0000-4000-8000-000000000bd1')
        = (select sum(amount) from public.wallet_entries where user_id = '00000000-0000-4000-8000-000000000bd1'),
  'баланс по-прежнему равен сумме журнала');

-- Удаленный аккаунт больше ничего не может.
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000bd1'); end $$;
select is(public.place_bet('ab000000-0000-4000-8000-000000000002', 'HOME', 100, 1, gen_random_uuid()) ->> 'code',
  'ACCOUNT_DISABLED', 'удаленный аккаунт не делает прогнозы');
select is(public.is_admin(), false, 'удаленный аккаунт не администратор');
-- RLS разрешает правку имени только неотключенному профилю: запрос проходит, но не меняет ни одной строки.
update public.profiles set display_name = 'вернуть' where id = '00000000-0000-4000-8000-000000000bd1';
reset role;
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000bd1'),
  'Удалённый игрок', 'имя удаленного профиля не восстанавливается самим пользователем');

-- Другие пользователи не затронуты.
select is((select array[display_name] from public.profiles where id = '00000000-0000-4000-8000-000000000bd2'),
  array['staying_user'], 'другой пользователь не затронут');

-- Права.
select ok(not has_function_privilege('anon', 'public.delete_my_account()', 'execute'), 'гость не вызывает удаление');
set local role anon;
select throws_ok($$ select public.delete_my_account() $$, '42501', null, 'гостю удаление недоступно');
reset role;
do $$ begin perform set_config('request.jwt.claims', '', true); end $$;
select throws_ok($$ select public.delete_my_account() $$, '28000', 'UNAUTHENTICATED',
  'без пользователя в токене удаление невозможно');

select * from finish();
rollback;
