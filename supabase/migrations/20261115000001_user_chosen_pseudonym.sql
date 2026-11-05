-- Псевдоним выбирает сам пользователь (ADR-072). Заменяет автогенерацию из ADR-069/070. Этап 11.
--
-- Порядок для пользователя: вход через GitHub → сайт просит придумать псевдоним. Придумывать имя за
-- игрока нельзя, поэтому после входа профиль создается БЕЗ имени (display_name = NULL), а имя задается
-- функцией set_pseudonym(). Пока имени нет, игрока нет в рейтинге.
-- Остается: запрет аватара (ADR-069) и уникальный индекс profiles_display_name_unique (ADR-070).

-- ---------------------------------------------------------------- имя может быть не задано
alter table public.profiles alter column display_name drop not null;

-- Автоматические псевдонимы и имена, скопированные из GitHub, сбрасываются: каждый выбирает сам.
-- (До выпуска настоящих пользователей нет; после выпуска такой сброс потребовал бы уведомления.)
update public.profiles set display_name = null where deleted_at is null;

-- Имя меняется только через set_pseudonym(): прямой UPDATE обошел бы проверки (формат, занятость,
-- совпадение с логином GitHub, зарезервированные слова, ограничение частоты).
revoke update (display_name) on public.profiles from authenticated;

-- ---------------------------------------------------------------- инициализация без имени
-- Сигнатура и остальная логика (кошелек, стартовый кредит, отключенный аккаунт) без изменений.
-- Профиль читается одним запросом по ключу; вставка — только если профиля нет.
create or replace function public.ensure_user_initialized()
returns table (wallet_balance bigint, credited boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_initial_credit constant bigint := 10000;
  v_uid uuid := auth.uid();
  v_disabled timestamptz;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if not exists (select 1 from auth.users u where u.id = v_uid) then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select p.disabled_at into v_disabled from public.profiles p where p.id = v_uid;
  if not found then
    insert into public.profiles (id) values (v_uid) on conflict do nothing;
    select p.disabled_at into v_disabled from public.profiles p where p.id = v_uid;
  end if;

  if v_disabled is not null then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  insert into public.wallets (user_id, balance)
  values (v_uid, 0)
  on conflict do nothing;

  -- Без целевого ограничения: перехватываем и operation_key, и частичный уникальный индекс.
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values (v_uid, 'INITIAL_CREDIT', c_initial_credit, 'initial_credit:' || v_uid::text)
  on conflict do nothing
  returning id into v_entry_id;

  if v_entry_id is not null then
    update public.wallets set balance = balance + c_initial_credit where user_id = v_uid;
  end if;

  return query
    select w.balance, (v_entry_id is not null)
    from public.wallets w
    where w.user_id = v_uid;
end;
$$;

-- Автогенерация больше не используется.
drop function public.generate_pseudonym();

-- ---------------------------------------------------------------- выбор псевдонима
-- Результат — jsonb {ok: true, displayName} или {ok: false, code}:
--   INVALID_NAME      — длина 3–24 или недопустимые символы;
--   RESERVED_NAME     — служебные слова («Удалённый игрок», admin и т.п.);
--   MATCHES_ACCOUNT   — совпадает с логином, именем или частью почты из GitHub (иначе по рейтингу можно
--                       найти человека на GitHub);
--   NAME_TAKEN        — занят (без учета регистра; гонку решает уникальный индекс);
--   RATE_LIMITED, ACCOUNT_NOT_FOUND, ACCOUNT_DISABLED.
-- Повторная установка своего же имени проходит (идемпотентно); смена на другое разрешена.
create function public.set_pseudonym(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
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

  select p.disabled_at into v_disabled
  from public.profiles p where p.id = v_uid and p.deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  if v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_DISABLED');
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

  -- Не больше 10 попыток в минуту: нельзя перебирать занятые имена и раздувать журнал изменений.
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

-- ---------------------------------------------------------------- рейтинг без игроков без псевдонима
-- Тело прежнее (миграция 20261113000001) + условие display_name is not null.
create or replace function public.leaderboard_ranked()
returns table (
  user_id uuid,
  place bigint,
  display_name text,
  avatar_url text,
  settled_count bigint,
  won_count bigint,
  stakes bigint,
  net_profit bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with agg as (
    select
      b.user_id,
      count(*) as settled_count,
      count(*) filter (where b.status = 'WON') as won_count,
      sum(b.stake)::bigint as stakes,
      (sum(b.actual_payout) - sum(b.stake))::bigint as net_profit
    from public.bets b
    where b.status in ('WON', 'LOST')
    group by b.user_id
    having count(*) >= 5
  )
  select
    a.user_id,
    row_number() over (order by a.net_profit desc, a.settled_count desc, a.user_id),
    p.display_name,
    p.avatar_url,
    a.settled_count,
    a.won_count,
    a.stakes,
    a.net_profit
  from agg a
  join public.profiles p on p.id = a.user_id
  where p.disabled_at is null
    and p.display_name is not null
    and coalesce((
      select c.granted
      from public.user_consents c
      where c.user_id = a.user_id and c.kind = 'PUBLICATION'
      order by c.created_at desc, c.id desc
      limit 1
    ), false)
$$;
