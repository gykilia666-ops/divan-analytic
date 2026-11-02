-- RLS и явные grants (CLAUDE.md §13.1–13.2). Этап 2.
-- Принцип: anon и authenticated по умолчанию НЕ имеют прав; всё выдается явно.
-- Клиент никогда не пишет wallets, wallet_entries, bets, markets, matches, user_roles.
-- Запись выполняют только SECURITY DEFINER-функции и service_role.
--
-- ВАЖНО для будущих миграций: Supabase по умолчанию выдает anon/authenticated права на новые
-- таблицы. Ниже эти умолчания для схемы public отключаются, но EXECUTE для PUBLIC на функции
-- Postgres выдает всегда — каждая новая функция должна явно делать REVOKE ... FROM PUBLIC.

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.bets enable row level security;
alter table public.competitions enable row level security;
alter table public.teams enable row level security;
alter table public.matches enable row level security;
alter table public.markets enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Функции, доступные клиентам.
grant execute on function public.ensure_user_initialized() to authenticated;

-- Публичные спортивные данные: только чтение.
grant select on public.competitions, public.teams, public.matches, public.markets
  to anon, authenticated;

create policy competitions_public_read on public.competitions
  for select to anon, authenticated using (true);
create policy teams_public_read on public.teams
  for select to anon, authenticated using (true);
create policy matches_public_read on public.matches
  for select to anon, authenticated using (true);
create policy markets_public_read on public.markets
  for select to anon, authenticated using (true);

-- Приватные данные: только владелец, только чтение (кроме display_name).
grant select on public.profiles, public.wallets, public.wallet_entries, public.bets
  to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and disabled_at is null)
  with check (id = (select auth.uid()));
create policy wallets_select_own on public.wallets
  for select to authenticated using (user_id = (select auth.uid()));
create policy wallet_entries_select_own on public.wallet_entries
  for select to authenticated using (user_id = (select auth.uid()));
create policy bets_select_own on public.bets
  for select to authenticated using (user_id = (select auth.uid()));

-- user_roles: RLS включен, политик и grants для клиентов нет — доступ только у service_role.
