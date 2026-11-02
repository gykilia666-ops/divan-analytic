-- Инициализация пользователя: начисление один раз, имя, отключенный аккаунт (CLAUDE.md §6.3).
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000c1', 'c@test.local', '{"user_name":"charlie","avatar_url":"https://avatars.example/c.png"}'),
  ('00000000-0000-4000-8000-0000000000c2', 'd@test.local', '{"user_name":"ab"}'),
  ('00000000-0000-4000-8000-0000000000c3', 'e@test.local', '{"user_name":"abcdefghijklmnopqrstuvwxyz0123456789"}'),
  ('00000000-0000-4000-8000-0000000000c4', 'f@test.local', '{"user_name":"a<b>c","avatar_url":"javascript:alert(1)"}'),
  ('00000000-0000-4000-8000-0000000000c5', 'g@test.local', '{}');

-- ======================================================= первый вызов
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select is((select credited from public.ensure_user_initialized()), true, 'первый вызов начисляет монеты');
select is((select credited from public.ensure_user_initialized()), false, 'второй вызов не начисляет');
select is((select wallet_balance from public.ensure_user_initialized()), 10000::bigint,
  'баланс после повторных вызовов остается 10000');
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
select is((select avatar_url from public.profiles where id = '00000000-0000-4000-8000-0000000000c1'),
  'https://avatars.example/c.png', 'https-аватар сохраняется');

-- ======================================================= имена и аватары
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c2","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'имя короче 3 символов не ломает инициализацию');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c3","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'длинное имя не ломает инициализацию');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c4","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'имя с угловыми скобками не ломает инициализацию');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c5","role":"authenticated"}';
select lives_ok($$ select * from public.ensure_user_initialized() $$, 'пустые метаданные не ломают инициализацию');
reset role;

select matches((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c2'),
  '^Аналитик-[0-9a-f]{6}$', 'слишком короткое имя заменяется безопасной заглушкой');
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c3'),
  'abcdefghijklmnopqrstuvwx', 'длинное имя обрезается до 24 символов');
select is((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c4'),
  'abc', 'угловые скобки удаляются из имени');
select is((select avatar_url from public.profiles where id = '00000000-0000-4000-8000-0000000000c4'),
  null, 'небезопасный URL аватара отбрасывается');
select matches((select display_name from public.profiles where id = '00000000-0000-4000-8000-0000000000c5'),
  '^Аналитик-[0-9a-f]{6}$', 'без имени в метаданных используется заглушка');

-- ======================================================= отключенный аккаунт и неизвестный пользователь
update public.profiles set disabled_at = now() where id = '00000000-0000-4000-8000-0000000000c1';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select throws_ok($$ select * from public.ensure_user_initialized() $$, 'P0001', 'ACCOUNT_DISABLED',
  'отключенный аккаунт не проходит инициализацию');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000ff","role":"authenticated"}';
select throws_ok($$ select * from public.ensure_user_initialized() $$, '28000', null,
  'пользователь, которого нет в auth.users, не инициализируется');
reset role;

select is((select count(*) from public.wallets where user_id = '00000000-0000-4000-8000-0000000000ff'),
  0::bigint, 'для неизвестного пользователя кошелек не создан');

select * from finish();
rollback;
