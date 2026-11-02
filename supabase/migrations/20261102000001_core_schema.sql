-- Диванный аналитик: ядро схемы (CLAUDE.md §8). Этап 2.
-- Служебные таблицы (job_runs, job_leases, sync_cursors, provider_rate_limits, audit_events,
-- rate_limit_buckets, user_stats) создаются на этапах 7–9 отдельными миграциями (expand-only).
-- Внешние ключи без каскадного удаления: журнал и прогнозы не удаляются автоматически.

create type public.wallet_entry_kind as enum
  ('INITIAL_CREDIT', 'STAKE_DEBIT', 'WIN_CREDIT', 'VOID_REFUND', 'ADMIN_ADJUSTMENT');
create type public.match_status as enum
  ('SCHEDULED', 'LIVE', 'FINISHED', 'CANCELLED', 'POSTPONED', 'SUSPENDED');
-- NONE: итога нет; REGULAR: однозначный итог основного времени (ADR-009); AMBIGUOUS: не рассчитывать.
create type public.match_result_kind as enum ('NONE', 'REGULAR', 'AMBIGUOUS');
create type public.market_type as enum ('MATCH_RESULT_1X2');
create type public.market_status as enum ('OPEN', 'SUSPENDED', 'CLOSED', 'RESOLVED', 'VOID');
create type public.bet_outcome as enum ('HOME', 'DRAW', 'AWAY');
create type public.bet_status as enum ('PENDING', 'WON', 'LOST', 'VOID');
create type public.app_role as enum ('ADMIN');

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- пользователи и кошелек
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null,
  avatar_url text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length check (char_length(display_name) between 3 and 24),
  constraint profiles_display_name_safe check (display_name !~ '[[:cntrl:]<>]'),
  constraint profiles_avatar_https check (avatar_url is null or avatar_url ~ '^https://')
);

-- Роль хранится вне редактируемого профиля. Клиентам доступ не выдается.
create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete restrict,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.wallets (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  balance bigint not null default 0 constraint wallets_balance_non_negative check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- спортивные данные
create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  code text not null,
  name text not null,
  enabled boolean not null default false,
  unique (provider, provider_id)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  name text not null,
  short_name text,
  crest_url text,
  unique (provider, provider_id),
  constraint teams_crest_https check (crest_url is null or crest_url ~ '^https://')
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_id text not null,
  competition_id uuid not null references public.competitions (id) on delete restrict,
  home_team_id uuid not null references public.teams (id) on delete restrict,
  away_team_id uuid not null references public.teams (id) on delete restrict,
  kickoff_at timestamptz not null,
  status public.match_status not null,
  regulation_home_score integer,
  regulation_away_score integer,
  result_kind public.match_result_kind not null default 'NONE',
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  result_fingerprint text,
  result_first_seen_at timestamptz,
  result_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_id),
  constraint matches_teams_differ check (home_team_id <> away_team_id),
  constraint matches_scores_non_negative check (
    (regulation_home_score is null or regulation_home_score >= 0)
    and (regulation_away_score is null or regulation_away_score >= 0)
  ),
  -- null не означает 0: счет либо известен целиком, либо неизвестен.
  constraint matches_scores_both_or_neither check (
    (regulation_home_score is null) = (regulation_away_score is null)
  ),
  constraint matches_confirmation_order check (
    result_confirmed_at is null or result_first_seen_at is not null
  )
);

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete restrict,
  type public.market_type not null,
  status public.market_status not null default 'OPEN',
  quote_version integer not null default 1,
  model_version text not null,
  home_odds_milli integer not null,
  draw_odds_milli integer not null,
  away_odds_milli integer not null,
  resolved_outcome public.bet_outcome,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, type),
  constraint markets_quote_version_positive check (quote_version >= 1),
  -- Диапазон 1.10–12.00 (CLAUDE.md §7); odds_milli: 2350 = 2.350.
  constraint markets_home_odds_range check (home_odds_milli between 1100 and 12000),
  constraint markets_draw_odds_range check (draw_odds_milli between 1100 and 12000),
  constraint markets_away_odds_range check (away_odds_milli between 1100 and 12000),
  constraint markets_resolved_outcome_iff_resolved check (
    (status = 'RESOLVED') = (resolved_outcome is not null)
  ),
  constraint markets_resolved_at_iff_terminal check (
    (status in ('RESOLVED', 'VOID')) = (resolved_at is not null)
  )
);

-- ---------------------------------------------------------------- прогнозы и журнал
create table public.bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  market_id uuid not null references public.markets (id) on delete restrict,
  outcome public.bet_outcome not null,
  stake bigint not null,
  accepted_odds_milli integer not null,
  potential_payout bigint not null,
  actual_payout bigint,
  status public.bet_status not null default 'PENDING',
  idempotency_key uuid not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, idempotency_key),
  unique (user_id, market_id),
  constraint bets_stake_range check (stake between 10 and 1000),
  constraint bets_odds_range check (accepted_odds_milli between 1100 and 12000),
  -- Выплата включает ставку; целочисленное деление положительных чисел = floor.
  constraint bets_potential_payout_formula check (
    potential_payout = (stake * accepted_odds_milli) / 1000
  ),
  -- Явные "is not null" обязательны: CHECK пропускает NULL-результат выражения.
  constraint bets_state_consistent check (
    (status = 'PENDING' and settled_at is null and actual_payout is null)
    or (status = 'WON' and settled_at is not null and actual_payout is not null
        and actual_payout = potential_payout)
    or (status = 'LOST' and settled_at is not null and actual_payout is not null
        and actual_payout = 0)
    or (status = 'VOID' and settled_at is not null and actual_payout is not null
        and actual_payout = stake)
  )
);

create table public.wallet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.wallets (user_id) on delete restrict,
  kind public.wallet_entry_kind not null,
  amount bigint not null,
  bet_id uuid references public.bets (id) on delete restrict,
  operation_key text not null unique,
  created_at timestamptz not null default now(),
  constraint wallet_entries_operation_key_not_empty check (char_length(operation_key) > 0),
  constraint wallet_entries_amount_sign check (
    amount <> 0 and (
      (kind = 'INITIAL_CREDIT' and amount > 0)
      or (kind = 'STAKE_DEBIT' and amount < 0)
      or (kind in ('WIN_CREDIT', 'VOID_REFUND') and amount > 0)
      or kind = 'ADMIN_ADJUSTMENT'
    )
  ),
  constraint wallet_entries_bet_link check (
    (kind in ('STAKE_DEBIT', 'WIN_CREDIT', 'VOID_REFUND') and bet_id is not null)
    or (kind = 'INITIAL_CREDIT' and bet_id is null)
    or kind = 'ADMIN_ADJUSTMENT'
  )
);

-- Инварианты §8.2: один стартовый кредит на пользователя, один debit и одно расчетное начисление на прогноз.
create unique index wallet_entries_one_initial_credit on public.wallet_entries (user_id)
  where kind = 'INITIAL_CREDIT';
create unique index wallet_entries_one_stake_debit on public.wallet_entries (bet_id)
  where kind = 'STAKE_DEBIT';
create unique index wallet_entries_one_settlement on public.wallet_entries (bet_id)
  where kind in ('WIN_CREDIT', 'VOID_REFUND');

-- Индексы §8.3 (остальные — вместе с таблицами этапов 7–8).
create index matches_kickoff_idx on public.matches (kickoff_at, id);
create index matches_competition_kickoff_idx on public.matches (competition_id, kickoff_at, id);
create index matches_status_kickoff_idx on public.matches (status, kickoff_at);
create index bets_user_created_idx on public.bets (user_id, created_at desc, id desc);
create index bets_market_status_idx on public.bets (market_id, status);
create index wallet_entries_user_created_idx on public.wallet_entries (user_id, created_at desc, id desc);

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger wallets_set_updated_at before update on public.wallets
  for each row execute function public.set_updated_at();
create trigger matches_set_updated_at before update on public.matches
  for each row execute function public.set_updated_at();
create trigger markets_set_updated_at before update on public.markets
  for each row execute function public.set_updated_at();
