-- Выдать роль администратора по логину GitHub (не миграция; выполнить вручную в SQL Editor
-- или локально: npx supabase db query < supabase/admin/grant-admin.sql — замените REPLACE_ME).
insert into public.user_roles (user_id, role)
select u.id, 'ADMIN'
from auth.users u
where u.raw_user_meta_data ->> 'user_name' = 'REPLACE_ME'
on conflict do nothing;

-- Проверка:
--   select u.raw_user_meta_data ->> 'user_name', r.role
--   from public.user_roles r join auth.users u on u.id = r.user_id;
-- Отозвать:
--   delete from public.user_roles where role = 'ADMIN'
--     and user_id = (select id from auth.users where raw_user_meta_data ->> 'user_name' = 'REPLACE_ME');
