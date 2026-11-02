-- Атомарная идемпотентная инициализация пользователя (CLAUDE.md §6.3). Этап 2.
-- Вызывается из auth-callback (этап 3) через RPC от имени пользователя. Триггер на auth.users
-- намеренно не используется: функция сама идемпотентна и вызывается явно (ADR-014).
--
-- Конкурентность: профиль, кошелек и запись журнала вставляются через ON CONFLICT DO NOTHING.
-- Конкурирующий вызов ждет коммита первого и затем ничего не делает; баланс увеличивается
-- только если запись INITIAL_CREDIT действительно была вставлена этим вызовом.

create function public.ensure_user_initialized()
returns table (wallet_balance bigint, credited boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_initial_credit constant bigint := 10000;
  v_uid uuid := auth.uid();
  v_meta jsonb;
  v_name text;
  v_avatar text;
  v_disabled timestamptz;
  v_entry_id uuid;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  select u.raw_user_meta_data into v_meta from auth.users u where u.id = v_uid;
  if not found then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  v_meta := coalesce(v_meta, '{}'::jsonb);

  -- Имя: 3–24 символа, без управляющих символов и угловых скобок; иначе безопасная заглушка.
  v_name := coalesce(
    nullif(v_meta ->> 'user_name', ''),
    nullif(v_meta ->> 'preferred_username', ''),
    nullif(v_meta ->> 'name', ''),
    ''
  );
  v_name := btrim(left(btrim(regexp_replace(v_name, '[[:cntrl:]<>]', '', 'g')), 24));
  if char_length(v_name) < 3 then
    v_name := 'Аналитик-' || substr(replace(v_uid::text, '-', ''), 1, 6);
  end if;

  -- Аватар: только https и без пробельных/опасных символов; иначе локальный fallback в UI.
  v_avatar := v_meta ->> 'avatar_url';
  if v_avatar is null
     or char_length(v_avatar) > 500
     or v_avatar !~ '^https://[^[:space:]<>"]+$' then
    v_avatar := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (v_uid, v_name, v_avatar)
  on conflict do nothing;

  select p.disabled_at into v_disabled from public.profiles p where p.id = v_uid;
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

revoke all on function public.ensure_user_initialized() from public, anon, authenticated;
grant execute on function public.ensure_user_initialized() to authenticated;
