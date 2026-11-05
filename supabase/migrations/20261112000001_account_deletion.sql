-- Удаление аккаунта по запросу пользователя (CLAUDE.md §8.4). Этап 11.
-- Решение (ADR-061): журнал операций и прогнозы НЕ удаляются (append-only, на них держатся инварианты и
-- проверочные пересчеты) — профиль обезличивается и отключается, роли снимаются. Учетная запись в Supabase
-- Auth мягко удаляется сервером (auth.admin.deleteUser(id, true)): строка остается для внешних ключей,
-- вход по ней невозможен, повторный вход через GitHub создает новый аккаунт.

alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles add constraint profiles_deleted_is_disabled
  check (deleted_at is null or disabled_at is not null);

create function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_profile from public.profiles where id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  if v_profile.deleted_at is not null then
    return jsonb_build_object('ok', true, 'alreadyDeleted', true);
  end if;

  update public.profiles
    set display_name = 'Удалённый игрок',
        avatar_url = null,
        disabled_at = coalesce(disabled_at, now()),
        deleted_at = now()
    where id = v_uid;
  delete from public.user_roles where user_id = v_uid;
  insert into public.audit_events (kind, user_id, details)
  values ('ACCOUNT_DELETED', v_uid, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'alreadyDeleted', false);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
