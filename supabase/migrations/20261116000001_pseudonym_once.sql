-- Псевдоним выбирается один раз и больше не меняется (ADR-073, уточнение ADR-072).
-- Прежняя set_pseudonym() позволяла менять имя сколько угодно раз; теперь, если имя уже выбрано,
-- функция возвращает ALREADY_SET и ничего не пишет. Повтор того же самого имени (двойной клик,
-- повторная отправка формы) проходит как успех — ничего не меняется.
-- Прямой UPDATE display_name клиентским ролям закрыт миграцией 20261115000001, поэтому обойти
-- правило через API нельзя. Сбросить имя (нарушение правил, обращение пользователя) может только
-- оператор из-под сервисной роли: update public.profiles set display_name = null where id = '…'.
-- ALREADY_SET отдается до проверки частоты: у кого имя есть, тот лимит попыток не расходует.
create or replace function public.set_pseudonym(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_current text;
  v_disabled timestamptz;
  v_meta jsonb;
  v_email text;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- Пробелы по краям убираются, повторные схлопываются.
  v_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:space:]]+', ' ', 'g'));
  if char_length(v_name) not between 3 and 24
     or v_name !~ '^[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9 ._-]*$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_NAME');
  end if;

  select p.disabled_at, p.display_name into v_disabled, v_current
  from public.profiles p where p.id = v_uid and p.deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  if v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_DISABLED');
  end if;

  -- Имя уже выбрано: менять нельзя; то же самое имя — успех без записи.
  if v_current is not null then
    if v_current = v_name then
      return jsonb_build_object('ok', true, 'displayName', v_current);
    end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SET');
  end if;

  if lower(v_name) in (
    'удалённый игрок', 'удаленный игрок', 'удалённый', 'удаленный',
    'admin', 'administrator', 'админ', 'администратор',
    'moderator', 'модератор', 'support', 'поддержка', 'система', 'system'
  ) then
    return jsonb_build_object('ok', false, 'code', 'RESERVED_NAME');
  end if;

  select u.raw_user_meta_data, u.email into v_meta, v_email from auth.users u where u.id = v_uid;
  if exists (
    select 1
    from unnest(array[
      v_meta ->> 'user_name', v_meta ->> 'preferred_username',
      v_meta ->> 'name', v_meta ->> 'full_name',
      split_part(coalesce(v_email, ''), '@', 1)
    ]) as t(x)
    where t.x is not null and btrim(t.x) <> '' and lower(btrim(t.x)) = lower(v_name)
  ) then
    return jsonb_build_object('ok', false, 'code', 'MATCHES_ACCOUNT');
  end if;

  -- Не больше 10 попыток в минуту: нельзя перебирать занятые имена.
  if not public.rate_limit_hit('pseudonym:' || v_uid::text, 10, 60) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  begin
    update public.profiles set display_name = v_name where id = v_uid;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'NAME_TAKEN');
  end;

  return jsonb_build_object('ok', true, 'displayName', v_name);
end;
$$;

revoke all on function public.set_pseudonym(text) from public, anon;
grant execute on function public.set_pseudonym(text) to authenticated;
