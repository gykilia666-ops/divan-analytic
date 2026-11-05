-- Выбор псевдонима пользователем: проверки формата, занятость без учета регистра, совпадение с данными GitHub,
-- зарезервированные слова, ограничение частоты, однократность выбора (ADR-072, ADR-070, ADR-073). Этап 11.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000d01', 'secret.local@test.local',
   '{"user_name":"GitHubLogin","name":"Real Name"}'),
  ('00000000-0000-4000-8000-000000000d02', 'd02@test.local', '{}'),
  ('00000000-0000-4000-8000-000000000d03', 'd03@test.local', '{}'),
  ('00000000-0000-4000-8000-000000000d04', 'd04@test.local', '{}'),
  ('00000000-0000-4000-8000-000000000d05', 'd05@test.local', '{}');

create function pg_temp.as_user(p_uid text) returns void language plpgsql as $f$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end;
$f$;


-- ======================================================= права и индекс
select ok(not has_function_privilege('anon', 'public.set_pseudonym(text)', 'execute'), 'гость не вызывает set_pseudonym');
select ok(has_function_privilege('authenticated', 'public.set_pseudonym(text)', 'execute'), 'вошедший вызывает set_pseudonym');
select ok(exists (
  select 1 from pg_indexes
   where schemaname = 'public' and tablename = 'profiles' and indexname = 'profiles_display_name_unique'
     and indexdef ilike 'create unique index%' and indexdef ilike '%lower(display_name)%'
     and indexdef ilike '%deleted_at is null%'
), 'уникальный индекс по lower(display_name) для неудаленных профилей существует');
select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-000000000d0%'),
  0::bigint, 'до выбора имени профилей нет: вход ничего не создает (ADR-075)');

-- ======================================================= проверки формата (пользователь d01)
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01'); end $$;
select is(public.set_pseudonym('ab') ->> 'code', 'INVALID_NAME', 'слишком короткий');
select is(public.set_pseudonym(repeat('я', 25)) ->> 'code', 'INVALID_NAME', 'слишком длинный (25 символов)');
select is(public.set_pseudonym('a<b>c') ->> 'code', 'INVALID_NAME', 'угловые скобки запрещены');
select is(public.set_pseudonym('_начало') ->> 'code', 'INVALID_NAME', 'нельзя начинать со знака подчеркивания');
select is(public.set_pseudonym('   ') ->> 'code', 'INVALID_NAME', 'только пробелы');
select is(public.set_pseudonym(null) ->> 'code', 'INVALID_NAME', 'пустое значение');
select is(public.set_pseudonym('Игрок😀') ->> 'code', 'INVALID_NAME', 'эмодзи запрещены');

-- Зарезервированные слова и совпадение с данными GitHub.
select is(public.set_pseudonym('Удалённый игрок') ->> 'code', 'RESERVED_NAME', 'служебное имя занять нельзя');
select is(public.set_pseudonym('ADMIN') ->> 'code', 'RESERVED_NAME', 'admin зарезервирован (без учета регистра)');
select is(public.set_pseudonym('githublogin') ->> 'code', 'MATCHES_ACCOUNT', 'логин GitHub (без учета регистра) не принимается');
select is(public.set_pseudonym('real name') ->> 'code', 'MATCHES_ACCOUNT', 'имя из GitHub не принимается');
select is(public.set_pseudonym('Secret.Local') ->> 'code', 'MATCHES_ACCOUNT', 'часть почты до @ не принимается');

-- Успешный выбор: пробелы нормализуются.
select is(public.set_pseudonym('  Тихий   Форвард ') ->> 'displayName', 'Тихий Форвард', 'пробелы нормализованы');
reset role;
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-000000000d01'),
  'Тихий Форвард', 'псевдоним сохранен в профиле');

-- ======================================================= занятость без учета регистра (пользователь d02)
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d02'); end $$;
select is(public.set_pseudonym('тихий форвард') ->> 'code', 'NAME_TAKEN', 'занятое имя другим регистром отклонено');
select is(public.set_pseudonym('ТИХИЙ ФОРВАРД') ->> 'code', 'NAME_TAKEN', 'занятое имя заглавными отклонено');
select is((public.set_pseudonym('Другой Игрок') ->> 'ok')::boolean, true, 'свободное имя принято');

-- Прямое изменение запрещено: все проверки только через функцию.
select throws_ok($$ update public.profiles set display_name = 'Хитрый Обход' $$, '42501', null,
  'клиент не может менять имя напрямую');
reset role;

-- ======================================================= имя выбирается один раз (ADR-073)
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d01'); end $$;
select is((public.set_pseudonym('Тихий Форвард') ->> 'ok')::boolean, true, 'повтор того же имени проходит (идемпотентно)');
select is(public.set_pseudonym('  Тихий   Форвард ') ->> 'displayName', 'Тихий Форвард', 'повтор с лишними пробелами тоже');
select is(public.set_pseudonym('Новое Имя') ->> 'code', 'ALREADY_SET', 'сменить выбранное имя нельзя');
select is(public.set_pseudonym('тихий форвард') ->> 'code', 'ALREADY_SET', 'даже изменить только регистр нельзя');
select is(public.set_pseudonym('Другой Игрок') ->> 'code', 'ALREADY_SET', 'и занять имя другого игрока — тоже отказ «уже выбрано»');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d02'); end $$;
select is(public.set_pseudonym('Свободное Имя') ->> 'code', 'ALREADY_SET', 'у второго игрока то же правило');
reset role;
select is((select array_agg(display_name order by id) from public.profiles
           where id in ('00000000-0000-4000-8000-000000000d01', '00000000-0000-4000-8000-000000000d02')),
  array['Тихий Форвард', 'Другой Игрок'], 'имена в профилях не изменились');
select is((select count(*) from public.profiles where lower(display_name) = 'новое имя'),
  0::bigint, 'попытка смены ничего не записала');

-- Сброс оператором (сервисная роль, не клиент) возвращает право выбрать имя заново.
update public.profiles set display_name = null where id = '00000000-0000-4000-8000-000000000d02';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d02'); end $$;
select is((public.set_pseudonym('Новый Выбор') ->> 'ok')::boolean, true, 'после сброса оператором имя выбирается снова');
reset role;

-- ======================================================= удаленные профили не мешают
do $$ begin
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d03');
  perform public.set_pseudonym('Третий Игрок');
  perform pg_temp.as_user('00000000-0000-4000-8000-000000000d04');
  perform public.set_pseudonym('Четвёртый Игрок');
end $$;
reset role;
update public.profiles set display_name = 'Удалённый игрок', deleted_at = now(), disabled_at = now()
  where id = '00000000-0000-4000-8000-000000000d04';
select lives_ok(
  $$ update public.profiles set display_name = 'Удалённый игрок', deleted_at = now(), disabled_at = now()
     where id = '00000000-0000-4000-8000-000000000d03' $$,
  'два удаленных профиля могут называться «Удалённый игрок»');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d04'); end $$;
select is(public.set_pseudonym('Из Удаленных') ->> 'code', 'ACCOUNT_NOT_FOUND', 'удаленный профиль имя задать не может');
reset role;

-- ======================================================= отключенный, неинициализированный
update public.profiles set deleted_at = null, disabled_at = now(), display_name = null
  where id = '00000000-0000-4000-8000-000000000d03';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d03'); end $$;
select is(public.set_pseudonym('Отключенный') ->> 'code', 'ACCOUNT_DISABLED', 'отключенный аккаунт имя задать не может');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d05'); end $$;
select is((public.set_pseudonym('Без Входа') ->> 'ok')::boolean, true, 'профиль создается самим выбором имени, отдельная инициализация не нужна');
reset role;
select is((select balance from public.wallets where user_id = '00000000-0000-4000-8000-000000000d05'), 10000::bigint,
  'вместе с профилем создан кошелек со стартовым кредитом');

-- ======================================================= профиль без имени от прежней схемы и удаленная учетная запись входа
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000d07', 'd07@test.local', '{}'),
  ('00000000-0000-4000-8000-000000000d08', 'd08@test.local', '{}');
insert into public.profiles (id) values ('00000000-0000-4000-8000-000000000d07');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d07'); end $$;
select is((public.set_pseudonym('Старый Профиль') ->> 'ok')::boolean, true, 'профиль без имени дозаполняется');
reset role;
select is((select array[display_name, (select balance::text from public.wallets where user_id = p.id)]
           from public.profiles p where id = '00000000-0000-4000-8000-000000000d07'),
  array['Старый Профиль', '10000'], 'и получает кошелек со стартовым кредитом один раз');
update auth.users set deleted_at = now() where id = '00000000-0000-4000-8000-000000000d08';
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d08'); end $$;
select is(public.set_pseudonym('Из Удаленных 2') ->> 'code', 'ACCOUNT_NOT_FOUND', 'удаленная учетная запись входа аккаунт не создает');
reset role;
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-000000000d08'), 0::bigint,
  'профиль для нее не создан');

-- ======================================================= ограничение частоты (10 в минуту)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000d06', 'd06@test.local', '{}');
do $$ begin perform pg_temp.as_user('00000000-0000-4000-8000-000000000d06'); end $$;
-- Попытки с занятым именем (оно у d01) считаются в лимит; перебор чужих имен ограничен.
select is(
  (select count(*) filter (where r ->> 'code' = 'NAME_TAKEN')
     from (select public.set_pseudonym('Тихий Форвард') r from generate_series(1, 10) n) x),
  10::bigint, 'десять попыток подряд обрабатываются');
select is(public.set_pseudonym('Игрок 11') ->> 'code', 'RATE_LIMITED', 'одиннадцатая за минуту отклонена');
reset role;

select * from finish();
rollback;
