-- Псевдонимы вместо логина и аватара GitHub (ADR-069) и их уникальность на уровне БД (ADR-070). Этап 11.
--
-- Проблема: профиль копировал логин и аватар GitHub и показывал их в рейтинге. Ссылка на аватар GitHub
-- содержит числовой идентификатор аккаунта, логин ведет на публичный профиль: по рейтингу можно было найти
-- человека на GitHub.
-- Решение: сервис сам присваивает псевдоним при первой инициализации, а логин, имя и аватар GitHub в
-- public не копирует. Колонка avatar_url остается (форма публичных DTO не меняется), но всегда пустая:
-- это закреплено ограничением.
-- Уникальность: два игрока не могут иметь один псевдоним. Её гарантирует уникальный индекс, а не
-- проверочные запросы: генератор ничего не читает из таблицы, вставка повторяется только при конфликте
-- (редкий случай), а гонка двух одновременных вызовов разрешается самим индексом.
-- Данные GitHub по-прежнему хранит Supabase Auth (auth.users); клиентам они недоступны.

-- ---------------------------------------------------------------- генератор псевдонимов
-- «Прилагательное_Существительное_NNNN», до 21 символа (ограничение профиля — 24). Случайный, не выводится
-- из логина, почты или идентификатора. Таблиц не читает: свободность имени проверяет уникальный индекс.
create function public.generate_pseudonym()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  c_adj constant text[] := array[
    'Меткий', 'Быстрый', 'Хитрый', 'Упорный', 'Дерзкий', 'Зоркий', 'Смелый', 'Ловкий',
    'Мудрый', 'Точный', 'Бойкий', 'Тихий', 'Лихой', 'Резкий', 'Стойкий', 'Яркий'
  ];
  c_noun constant text[] := array[
    'Форвард', 'Защитник', 'Вратарь', 'Тренер', 'Аналитик', 'Капитан', 'Тактик', 'Судья',
    'Стратег', 'Эксперт', 'Скаут', 'Дебютант', 'Ветеран', 'Легионер', 'Диванщик', 'Хавбек'
  ];
begin
  return c_adj[1 + floor(random() * array_length(c_adj, 1))::integer]
    || '_' || c_noun[1 + floor(random() * array_length(c_noun, 1))::integer]
    || '_' || lpad(floor(random() * 10000)::integer::text, 4, '0');
end;
$$;

-- Внутренняя функция: вызывается только из ensure_user_initialized (SECURITY DEFINER) и этой миграции.
revoke all on function public.generate_pseudonym() from public, anon, authenticated;

-- ---------------------------------------------------------------- уже существующие профили
-- Один раз при применении миграции (на работе сервиса не сказывается). Заменяются имена, не похожие на
-- псевдоним (в том числе скопированные из GitHub), и повторы: у самого раннего профиля имя остается.
-- Удаленные профили («Удалённый игрок») не трогаем: на них уникальность не распространяется.
do $$
declare
  r record;
  v_name text;
  v_try integer;
begin
  for r in
    select x.id
      from (
        select p.id, p.display_name,
               row_number() over (partition by lower(p.display_name) order by p.created_at, p.id) as rn
          from public.profiles p
         where p.deleted_at is null
      ) x
     where x.display_name !~ '^[А-Я][а-я]+_[А-Я][а-я]+_[0-9]{4}$' or x.rn > 1
  loop
    v_try := 0;
    loop
      v_try := v_try + 1;
      v_name := public.generate_pseudonym();
      exit when v_try >= 50 or not exists (
        select 1 from public.profiles p
         where p.deleted_at is null and lower(p.display_name) = lower(v_name)
      );
    end loop;
    update public.profiles set display_name = v_name where id = r.id;
  end loop;
end
$$;

update public.profiles set avatar_url = null where avatar_url is not null;

alter table public.profiles
  add constraint profiles_no_avatar check (avatar_url is null);

comment on column public.profiles.avatar_url is
  'Всегда пусто (ADR-069): ссылка на аватар GitHub содержит идентификатор аккаунта.';

-- ---------------------------------------------------------------- уникальность
-- Без учета регистра; удаленные профили исключены (у них одинаковое «Удалённый игрок», deleted_at
-- выставляется тем же UPDATE, что и имя).
create unique index profiles_display_name_unique
  on public.profiles (lower(display_name))
  where deleted_at is null;

-- ---------------------------------------------------------------- инициализация без данных GitHub
-- Сигнатура и остальная логика (кошелек, стартовый кредит, отключенный аккаунт) без изменений;
-- права EXECUTE сохраняются при create or replace.
--
-- Запросов не больше, чем раньше: профиль читается одним запросом по первичному ключу (он и так нужен для
-- проверки блокировки). Псевдоним создается только если профиля нет, то есть один раз за жизнь аккаунта.
-- Конфликт имени (редко) — повтор с новым именем, до c_max_attempts раз; конфликт по первичному ключу —
-- профиль уже создал параллельный вызов, повтор не нужен.
create or replace function public.ensure_user_initialized()
returns table (wallet_balance bigint, credited boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_initial_credit constant bigint := 10000;
  c_max_attempts constant integer := 10;
  v_uid uuid := auth.uid();
  v_disabled timestamptz;
  v_attempt integer := 0;
  v_constraint text;
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
    loop
      v_attempt := v_attempt + 1;
      begin
        insert into public.profiles (id, display_name)
        values (v_uid, public.generate_pseudonym());
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'profiles_display_name_unique' then
          exit; -- профиль уже создан параллельным вызовом
        end if;
        if v_attempt >= c_max_attempts then
          raise;
        end if;
      end;
    end loop;
    -- Параллельный вызов мог создать профиль раньше нас: заново читаем признак блокировки.
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
