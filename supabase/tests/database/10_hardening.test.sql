-- Hardening (§13): лимит ручного запуска 5 минут, отсутствие прав на запись у клиентов,
-- SECURITY DEFINER только с фиксированным search_path. Этап 10.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000aa1', 'a10@test.local', '{"user_name":"admin10"}');
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000aa1","role":"authenticated"}', true);
  perform public.set_pseudonym('Игрок Десять');
end $$;
reset role;
insert into public.user_roles (user_id, role) values ('00000000-0000-4000-8000-000000000aa1', 'ADMIN');

-- ======================================================= ручной запуск: 1 раз в 5 минут
delete from public.rate_limit_buckets where bucket_key = 'admin:sync';
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000aa1","role":"authenticated"}', true);
end $$;
select is(public.admin_request_sync() ->> 'ok', 'true', 'первый ручной запуск разрешен');
reset role;
update public.rate_limit_buckets set window_start = window_start - interval '4 minutes' where bucket_key = 'admin:sync';
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000aa1","role":"authenticated"}', true);
end $$;
select is(public.admin_request_sync() ->> 'code', 'RATE_LIMITED', 'через 4 минуты — еще рано');
reset role;
update public.rate_limit_buckets set window_start = window_start - interval '2 minutes' where bucket_key = 'admin:sync';
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000aa1","role":"authenticated"}', true);
end $$;
select is(public.admin_request_sync() ->> 'ok', 'true', 'через 5+ минут — снова можно');
reset role;

-- ======================================================= общие инварианты прав
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')),
  0::bigint, 'клиентские роли не вставляют и не удаляют строки ни в одной таблице public');
select is(
  (select array_agg(table_name::text || '.' || privilege_type order by table_name)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type = 'UPDATE'),
  null::text[], 'клиентские роли не имеют табличного UPDATE (только колонка display_name)');
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  null::text[], 'у всех SECURITY DEFINER функций зафиксирован search_path');
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'),
  'RLS включен на всех таблицах public');

select * from finish();
rollback;
