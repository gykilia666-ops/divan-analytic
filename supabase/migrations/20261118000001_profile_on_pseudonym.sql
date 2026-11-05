-- Профиль и кошелек создаются только при выборе псевдонима (ADR-075, уточнение ADR-072/074).
-- Раньше вход через GitHub сразу создавал профиль, кошелек и начислял 10 000 монет (ensure_user_initialized),
-- а имя выбиралось позже: у каждого, кто вошел и ушел, оставались «пустые» строки. Теперь:
--   * вход ничего не создает в public.profiles / wallets / wallet_entries (в auth.users строку создает Supabase);
--   * set_pseudonym() в одной транзакции создает профиль с именем, кошелек и стартовый кредит;
--   * согласия при входе пишутся без профиля: user_consents и audit_events ссылаются на auth.users;
--   * ensure_user_initialized() удалена; place_bet без профиля отвечает PSEUDONYM_REQUIRED.
-- Профили без имени, оставшиеся от прежней схемы (и после сброса имени оператором), set_pseudonym дозаполняет.

-- ---------------------------------------------------------------- ссылки на auth.users
alter table public.user_consents drop constraint if exists user_consents_user_id_fkey;
alter table public.user_consents
  add constraint user_consents_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict;
alter table public.audit_events drop constraint if exists audit_events_user_id_fkey;
alter table public.audit_events
  add constraint audit_events_user_id_fkey foreign key (user_id) references auth.users (id) on delete restrict;

-- ---------------------------------------------------------------- инициализация при входе больше не нужна
drop function public.ensure_user_initialized();

-- ---------------------------------------------------------------- согласия без профиля
-- Профиля может еще не быть. Конкурентные входы одного пользователя идут по очереди (advisory-блокировка).
create or replace function public.record_consents(p_version text, p_publication boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_disabled timestamptz;
  v_deleted timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VERSION');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('consents:' || v_uid::text, 0));
  select p.disabled_at, p.deleted_at into v_disabled, v_deleted from public.profiles p where p.id = v_uid;
  if found then
    if v_deleted is not null then
      return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
    end if;
    if v_disabled is not null then
      raise exception 'ACCOUNT_DISABLED';
    end if;
  end if;

  perform public.consent_append(v_uid, 'TERMS_AND_AGE', p_version, true);
  perform public.consent_append(v_uid, 'PD_PROCESSING', p_version, true);
  if coalesce(p_publication, false) then
    perform public.consent_append(v_uid, 'PUBLICATION', p_version, true);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_publication_consent(p_granted boolean, p_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_disabled timestamptz;
  v_deleted timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_granted is null or p_version is null or p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_VERSION');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('consents:' || v_uid::text, 0));
  select p.disabled_at, p.deleted_at into v_disabled, v_deleted from public.profiles p where p.id = v_uid;
  if found and (v_deleted is not null or v_disabled is not null) then
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

-- ---------------------------------------------------------------- выбор псевдонима = создание аккаунта
-- Результат: {ok:true, displayName} или {ok:false, code}; коды как раньше (INVALID_NAME, RESERVED_NAME,
-- MATCHES_ACCOUNT, NAME_TAKEN, RATE_LIMITED, ACCOUNT_NOT_FOUND = аккаунт удален, ACCOUNT_DISABLED, ALREADY_SET).
-- Профиль, кошелек и стартовый кредит создаются в этой же транзакции; повторный вызов ничего не начисляет.
create or replace function public.set_pseudonym(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_initial_credit constant bigint := 10000;
  v_uid uuid := (select auth.uid());
  v_name text;
  v_current text;
  v_disabled timestamptz;
  v_deleted timestamptz;
  v_has_profile boolean;
  v_meta jsonb;
  v_email text;
  v_user_found boolean;
  v_auth_deleted timestamptz;
  v_entry_id uuid;
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

  -- Профиля может не быть: параллельные вызовы одного пользователя идут по очереди.
  perform pg_advisory_xact_lock(hashtextextended('pseudonym:' || v_uid::text, 0));
  select p.disabled_at, p.deleted_at, p.display_name into v_disabled, v_deleted, v_current
  from public.profiles p where p.id = v_uid for update;
  v_has_profile := found;
  if v_has_profile and v_deleted is not null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
  if v_has_profile and v_disabled is not null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_DISABLED');
  end if;

  -- Имя уже выбрано: менять нельзя (ADR-073); то же самое имя — успех без записи.
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

  select u.raw_user_meta_data, u.email, u.deleted_at, true into v_meta, v_email, v_auth_deleted, v_user_found
  from auth.users u where u.id = v_uid;
  if not coalesce(v_user_found, false) then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  -- Учетная запись входа удалена (мягко, ADR-061), а токен еще действует: профиль не создаем.
  if v_auth_deleted is not null then
    return jsonb_build_object('ok', false, 'code', 'ACCOUNT_NOT_FOUND');
  end if;
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
    if v_has_profile then
      update public.profiles set display_name = v_name where id = v_uid;
    else
      insert into public.profiles (id, display_name) values (v_uid, v_name);
    end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'NAME_TAKEN');
  end;

  -- Кошелек и стартовый кредит (бывшая ensure_user_initialized): ровно один раз.
  insert into public.wallets (user_id, balance) values (v_uid, 0) on conflict do nothing;
  insert into public.wallet_entries (user_id, kind, amount, operation_key)
  values (v_uid, 'INITIAL_CREDIT', c_initial_credit, 'initial_credit:' || v_uid::text)
  on conflict do nothing
  returning id into v_entry_id;
  if v_entry_id is not null then
    update public.wallets set balance = balance + c_initial_credit where user_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'displayName', v_name);
end;
$$;

-- ---------------------------------------------------------------- удаление аккаунта без профиля
-- Тело прежнее (миграция 20261113000001); если профиля нет (имя не выбиралось), профиль не создается:
-- только отзыв согласий и запись в аудит.
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
  perform pg_advisory_xact_lock(hashtextextended('consents:' || v_uid::text, 0));
  select * into v_profile from public.profiles where id = v_uid for update;
  if found and v_profile.deleted_at is not null then
    return jsonb_build_object('ok', true, 'alreadyDeleted', true);
  end if;
  if not found and exists (
    select 1 from public.audit_events a where a.kind = 'ACCOUNT_DELETED' and a.user_id = v_uid
  ) then
    return jsonb_build_object('ok', true, 'alreadyDeleted', true);
  end if;

  if found then
    update public.profiles
      set display_name = 'Удалённый игрок',
          avatar_url = null,
          disabled_at = coalesce(disabled_at, now()),
          deleted_at = now()
      where id = v_uid;
    delete from public.user_roles where user_id = v_uid;
  end if;

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

-- ---------------------------------------------------------------- прием прогноза без профиля
-- Тело из миграции 20261117000001; единственное отличие: нет профиля -> PSEUDONYM_REQUIRED (а не ACCOUNT_NOT_READY).
create or replace function public.place_bet(
  p_market_id uuid,
  p_outcome text,
  p_stake integer,
  p_quote_version integer,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_disabled timestamptz;
  v_pseudonym text;
  v_bet public.bets%rowtype;
  v_market public.markets%rowtype;
  v_match public.matches%rowtype;
  v_enabled boolean;
  v_balance bigint;
  v_odds integer;
begin
  if v_uid is null then
    return public.bet_error('UNAUTHENTICATED');
  end if;

  if p_market_id is null or p_idempotency_key is null or p_quote_version is null
     or p_outcome is null or p_outcome not in ('HOME', 'DRAW', 'AWAY')
     or p_stake is null or p_stake < 10 or p_stake > 1000 then
    return public.bet_error('VALIDATION_ERROR');
  end if;

  -- Отпечаток команды: тот же ключ с другим содержимым — конфликт.
  v_hash := md5(concat_ws('|', p_market_id::text, p_outcome, p_stake::text, p_quote_version::text));

  select p.disabled_at, p.display_name into v_disabled, v_pseudonym
  from public.profiles p where p.id = v_uid;
  if not found then
    -- Профиль создается только при выборе псевдонима (ADR-075): нет профиля = нет связки «GitHub — псевдоним».
    return public.bet_error('PSEUDONYM_REQUIRED');
  end if;
  if v_disabled is not null then
    return public.bet_error('ACCOUNT_DISABLED');
  end if;
  -- Аккаунт полноценный только со связкой «GitHub — псевдоним» (ADR-074): пока игрок не выбрал
  -- псевдоним, прогноз не принимается. Проверка стоит до повторов и лимита частоты и не расходует лимит.
  if v_pseudonym is null then
    return public.bet_error('PSEUDONYM_REQUIRED');
  end if;

  -- Повтор уже принятой команды: исходный результат, даже если рынок успел закрыться.
  -- Повторы не расходуют лимит частоты.
  select * into v_bet from public.bets b
    where b.user_id = v_uid and b.idempotency_key = p_idempotency_key;
  if found then
    if v_bet.request_hash <> v_hash then
      return public.bet_error('IDEMPOTENCY_CONFLICT');
    end if;
    return public.bet_success(v_bet, (select w.balance from public.wallets w where w.user_id = v_uid), true);
  end if;

  if not public.rate_limit_hit('place_bet:' || v_uid::text, 10, 60) then
    return public.bet_error('RATE_LIMITED');
  end if;

  select * into v_market from public.markets mk where mk.id = p_market_id for share;
  if not found then
    return public.bet_error('NOT_FOUND');
  end if;
  select * into v_match from public.matches m where m.id = v_market.match_id for share;
  select c.enabled into v_enabled from public.competitions c where c.id = v_match.competition_id;

  -- Время решает независимо от того, закрыла ли синхронизация рынок.
  if v_market.status <> 'OPEN'
     or v_match.status <> 'SCHEDULED'
     or not coalesce(v_enabled, false)
     or now() >= v_match.kickoff_at - interval '5 minutes' then
    return public.bet_error('MARKET_CLOSED');
  end if;
  if v_match.last_seen_at < now() - interval '60 minutes' then
    return public.bet_error('DATA_STALE');
  end if;
  if v_market.quote_version <> p_quote_version then
    return public.bet_error('QUOTE_CHANGED', jsonb_build_object('quoteVersion', v_market.quote_version));
  end if;

  select w.balance into v_balance from public.wallets w where w.user_id = v_uid for update;
  if not found then
    return public.bet_error('ACCOUNT_NOT_READY');
  end if;

  -- Кошелек заблокирован: параллельные запросы этого пользователя уже зафиксированы и видны.
  select * into v_bet from public.bets b
    where b.user_id = v_uid and b.idempotency_key = p_idempotency_key;
  if found then
    if v_bet.request_hash <> v_hash then
      return public.bet_error('IDEMPOTENCY_CONFLICT');
    end if;
    return public.bet_success(v_bet, v_balance, true);
  end if;
  if exists (select 1 from public.bets b where b.user_id = v_uid and b.market_id = p_market_id) then
    return public.bet_error('ALREADY_PLACED');
  end if;
  if v_balance < p_stake then
    return public.bet_error('INSUFFICIENT_BALANCE');
  end if;

  v_odds := case p_outcome
    when 'HOME' then v_market.home_odds_milli
    when 'DRAW' then v_market.draw_odds_milli
    else v_market.away_odds_milli
  end;

  insert into public.bets (
    user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout,
    idempotency_key, request_hash
  )
  values (
    v_uid, p_market_id, p_outcome::public.bet_outcome, p_stake, v_odds,
    (p_stake::bigint * v_odds) / 1000, p_idempotency_key, v_hash
  )
  returning * into v_bet;

  insert into public.wallet_entries (user_id, kind, amount, bet_id, operation_key)
  values (v_uid, 'STAKE_DEBIT', -p_stake, v_bet.id, 'stake:' || v_bet.id::text);

  update public.wallets set balance = balance - p_stake
    where user_id = v_uid
    returning balance into v_balance;

  return public.bet_success(v_bet, v_balance, false);
end;
$$;
