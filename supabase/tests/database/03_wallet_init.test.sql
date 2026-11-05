-- Создание аккаунта выбором псевдонима (ADR-075): профиль, кошелек и стартовый кредит появляются только
-- в set_pseudonym, один раз; без выбора имени в public.* ничего не создается. Отключенный и удаленный аккаунты.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'c@test.local', '{"user_name":"charlie","avatar_url":"https://avatars.example/c.png"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'd@test.local', '{"user_name":"ab"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'e@test.local', '{"user_name":"abcdefghijklmnopqrstuvwxyz0123456789"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'f@test.local', '{"user_name":"a<b>c","avatar_url":"javascript:alert(1)"}'),
  ('00000000-0000-4000-8000-0000000000c5', 'g@test.local', '{}'),
  ('00000000-0000-4000-8000-0000000000c6', 'h@test.local', '{}');

-- ======================================================= без выбора имени ничего не создается
select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-0000000000c%')
         + (select count(*) from public.wallets where user_id::text like '00000000-0000-4000-8000-0000000000c%')
         + (select count(*) from public.wallet_entries where user_id::text like '00000000-0000-4000-8000-0000000000c%'),
  0::bigint, 'после появления пользователя в auth.users профилей, кошельков и записей журнала нет');

-- ======================================================= первый выбор имени
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select is((public.set_pseudonym('Charlie Tester') ->> 'ok')::boolean, true, 'первый выбор имени проходит');
select is((public.set_pseudonym('Charlie Tester') ->> 'ok')::boolean, true, 'повтор того же имени проходит');
select is(public.set_pseudonym('Другое Имя') ->> 'code', 'ALREADY_SET', 'сменить имя нельзя');
select is((select balance from public.wallets), 10000::bigint, 'баланс после повторных вызовов остается 10000');
reset role;

select is((select count(*) from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000000c1'),
  1::bigint, 'в журнале ровно одна запись');
select is((select kind::text from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000000c1'),
  'INITIAL_CREDIT', 'вид записи INITIAL_CREDIT');
select is((select operation_key from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000000c1'),
  'initial_credit:00000000-0000-4000-8000-0000000000c1', 'operation_key детерминирован');
select is((select balance from public.wallets where user_id = '00000000-0000-4000-8000-0000000000c1'),
  (select sum(amount)::bigint from public.wallet_entries where user_id = '00000000-0000-4000-8000-0000000000c1'),
  'balance = SUM(журнала)');

-- ======================================================= данные GitHub в профиль не попадают
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'Charlie Tester', 'в профиле выбранный пользователем псевдоним');
select is((select avatar_url from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  null, 'аватар GitHub в профиль не копируется');

-- Любые метаданные GitHub (короткие, длинные, с тегами, пустые) выбор имени не ломают.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}';
select lives_ok($$ select public.set_pseudonym('Чарли Два') $$, 'короткое имя в метаданных не ломает создание аккаунта');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select lives_ok($$ select public.set_pseudonym('Чарли Три') $$, 'длинное имя в метаданных не ломает создание аккаунта');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated"}';
select lives_ok($$ select public.set_pseudonym('Чарли Четыре') $$, 'имя с угловыми скобками в метаданных не ломает создание аккаунта');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c6","role":"authenticated"}';
select lives_ok($$ select public.set_pseudonym('Чарли Шесть') $$, 'пустые метаданные не ломают создание аккаунта');
reset role;

select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-0000000000c%'),
  5::bigint, 'профили созданы у тех пятерых, кто выбрал имя; у c5 (не выбирал) профиля нет');
select is((select count(*) from public.wallets where user_id::text like '00000000-0000-4000-8000-0000000000c%' and balance = 10000),
  5::bigint, 'у каждого выбравшего один кошелек со стартовым кредитом');
select is((select count(*) from public.profiles where id::text like '00000000-0000-4000-8000-0000000000c%'
             and avatar_url is not null),
  0::bigint, 'ни у кого нет аватара');
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000c5'), 0::bigint,
  'не выбравший имя пользователь остается без профиля');

-- ======================================================= защита от возврата данных GitHub
select throws_ok(
  $$ update public.profiles set avatar_url = 'https://avatars.githubusercontent.com/u/1'
     where id = '00000000-0000-4000-8000-0000000000c1' $$,
  '23514', null, 'ограничение не позволяет сохранить ссылку на аватар');
select hasnt_function('public', 'generate_pseudonym', 'автогенерация псевдонимов удалена');
select hasnt_function('public', 'ensure_user_initialized', 'инициализация при входе удалена');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select throws_ok($$ update public.profiles set display_name = 'Charlie Hacker' $$, '42501', null,
  'клиент не может менять имя напрямую: только через set_pseudonym');
reset role;

-- ======================================================= отключенный, удаленный, неизвестный пользователь
update public.profiles set disabled_at = now() where id = '00000000-0000-4000-8000-0000000000c1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select is(public.set_pseudonym('Charlie Tester') ->> 'code', 'ACCOUNT_DISABLED', 'отключенный аккаунт имя не задает');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}';
select throws_ok($$ select public.set_pseudonym('Призрак Имя') $$, '28000', null,
  'пользователь, которого нет в auth.users, аккаунт не создает');
reset role;
select is((select count(*) from public.wallets where user_id = '00000000-0000-4000-8000-0000000000ff'),
  0::bigint, 'для неизвестного пользователя кошелек не создан');

-- Учетная запись входа удалена мягко, токен еще действует: профиль не создается.
update auth.users set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000c5';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}';
select is(public.set_pseudonym('Из Удаленных') ->> 'code', 'ACCOUNT_NOT_FOUND', 'удаленная учетная запись аккаунт не создает');
reset role;
select is((select count(*) from public.profiles where id = '00000000-0000-4000-8000-0000000000c5'), 0::bigint,
  'профиль для удаленной учетной записи не создан');

select * from finish();
rollback;
