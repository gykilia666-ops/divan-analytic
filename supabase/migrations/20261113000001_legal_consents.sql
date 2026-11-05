-- Согласия пользователя (ADR-065). Этап 11.
-- 1) user_consents — журнал согласий, только добавление (как wallet_entries): по нему можно показать,
--    что согласие получено, на какую версию документов и когда.
-- 2) record_consents — запись согласий при входе (auth-callback); set_publication_consent — выдача и
--    отзыв согласия на публикацию из раздела «Аккаунт»; my_consents — последнее состояние по видам.
-- 3) leaderboard_ranked показывает только тех, у кого последнее согласие PUBLICATION дано
--    (согласие на распространение, ст. 10.1 152-ФЗ, отдельное и необязательное).
-- 4) delete_my_account дополнительно фиксирует отзыв действующих согласий.
-- Порядок блокировок (ADR-037) не затронут: функции блокируют только строку своего профиля.

create type public.consent_kind as enum ('TERMS_AND_AGE', 'PD_PROCESSING', 'PUBLICATION');

create table public.user_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  kind public.consent_kind not null,
  doc_version text not null,
  granted boolean not null,
  created_at timestamptz not null default now(),
  constraint user_consents_version_format check (doc_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
-- «Последнее состояние вида согласия»: (user_id, kind) + свежие записи первыми.
create index user_consents_latest_idx on public.user_consents (user_id, kind, created_at desc, id desc);

create function public.user_consents_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'CONSENTS_APPEND_ONLY: consent records cannot be changed or deleted'
    using errcode = '55000';
  return null;
end;
$$;

create trigger user_consents_append_only
  before update or delete on public.user_consents
  for each row execute function public.user_consents_append_only();

alter table public.user_consents enable row level security;
revoke all on public.user_consents from anon, authenticated;
grant select on public.user_consents to authenticated;
create policy user_consents_select_own on public.user_consents
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- внутренний помощник
-- Добавляет запись, только если состояние или версия изменились: вход при каждой сессии не раздувает журнал.
create function public.consent_append(
  p_user uuid, p_kind public.consent_kind, p_version text, p_granted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last record;
begin
  select c.doc_version, c.granted into v_last
  from public.user_consents c
  where c.user_id = p_user and c.kind = p_kind
  order by c.created_at desc, c.id desc
  limit 1;
  if found and v_last.doc_version = p_version and v_last.granted = p_granted then
    return;
  end if;
  insert into public.user_consents (user_id, kind, doc_version, granted)
  values (p_user, p_kind, p_version, p_granted);
end;
$$;

-- ---------------------------------------------------------------- запись при входе
-- TERMS_AND_AGE и PD_PROCESSING обязательны для входа и пишутся всегда; PUBLICATION — только если отмечено
-- (неотмеченная отметка при входе существующее согласие не отзывает: отзыв — только в «Аккаунте»).
create function public.record_consents(p_version text, p_publication boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_disabled timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VERSION');
  end if;

  -- FOR UPDATE: конкурентные входы одного пользователя выполняются по очереди.
  select p.disabled_at into v_disabled
  from public.profiles p where p.id = v_uid and p.deleted_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  if v_disabled is not null then
    raise exception 'ACCOUNT_DISABLED';
  end if;

  perform public.consent_append(v_uid, 'TERMS_AND_AGE', p_version, true);
  perform public.consent_append(v_uid, 'PD_PROCESSING', p_version, true);
  if coalesce(p_publication, false) then
    perform public.consent_append(v_uid, 'PUBLICATION', p_version, true);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- выдача и отзыв публикации
create function public.set_publication_consent(p_granted boolean, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_granted is null or p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VERSION');
  end if;

  perform 1 from public.profiles p
  where p.id = v_uid and p.deleted_at is null and p.disabled_at is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  -- Не больше 10 переключений в минуту: журнал только растет, его нельзя раздувать.
  if not public.rate_limit_hit('consent:' || v_uid::text, 10, 60) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;

  perform public.consent_append(v_uid, 'PUBLICATION', p_version, p_granted);
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------- свои согласия
-- SECURITY INVOKER: RLS user_consents_select_own + явный фильтр по auth.uid().
create function public.my_consents()
returns table (kind public.consent_kind, doc_version text, granted boolean, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select distinct on (c.kind) c.kind, c.doc_version, c.granted, c.created_at
  from public.user_consents c
  where c.user_id = (select auth.uid())
  order by c.kind, c.created_at desc, c.id desc
$$;

-- ---------------------------------------------------------------- рейтинг только с согласием
-- Тело прежнее (миграция 20261109000001) + условие согласия. Сигнатура и права не меняются.
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
    and coalesce((
      select c.granted
      from public.user_consents c
      where c.user_id = a.user_id and c.kind = 'PUBLICATION'
      order by c.created_at desc, c.id desc
      limit 1
    ), false)
$$;

-- ---------------------------------------------------------------- удаление аккаунта = отзыв согласий
-- Тело прежнее (миграция 20261112000001) + запись об отзыве действующих согласий.
create or replace function public.delete_my_account()
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

  -- Удаление аккаунта = отзыв согласий: фиксируем «не дано» для видов, где последнее состояние «дано».
  insert into public.user_consents (user_id, kind, doc_version, granted)
  select l.user_id, l.kind, l.doc_version, false
  from (
    select distinct on (c.kind) c.user_id, c.kind, c.doc_version, c.granted
    from public.user_consents c
    where c.user_id = v_uid
    order by c.kind, c.created_at desc, c.id desc
  ) l
  where l.granted;

  insert into public.audit_events (kind, user_id, details)
  values ('ACCOUNT_DELETED', v_uid, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'alreadyDeleted', false);
end;
$$;

-- ---------------------------------------------------------------- права
revoke all on function public.consent_append(uuid, public.consent_kind, text, boolean)
  from public, anon, authenticated;
revoke all on function public.record_consents(text, boolean) from public, anon;
revoke all on function public.set_publication_consent(boolean, text) from public, anon;
revoke all on function public.my_consents() from public, anon;
grant execute on function public.record_consents(text, boolean) to authenticated;
grant execute on function public.set_publication_consent(boolean, text) to authenticated;
grant execute on function public.my_consents() to authenticated;
