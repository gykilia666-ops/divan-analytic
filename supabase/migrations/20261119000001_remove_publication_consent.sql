-- ADR-076: согласие на публикацию в рейтинге удалено полностью.
-- В рейтинг попадает любой игрок с псевдонимом, не отключенный, с >= 5 рассчитанными прогнозами.
-- Значение 'PUBLICATION' остается в enum consent_kind (значения enum не удаляются), старые строки журнала
-- сохраняются как история, но нигде не читаются и не создаются.

drop function public.set_publication_consent(boolean, text);
drop function public.record_consents(text, boolean);

create function public.record_consents(p_version text)
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
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.record_consents(text) from public, anon;
grant execute on function public.record_consents(text) to authenticated;

create or replace function public.my_consents()
returns table (kind public.consent_kind, doc_version text, granted boolean, created_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select distinct on (c.kind) c.kind, c.doc_version, c.granted, c.created_at
  from public.user_consents c
  where c.user_id = (select auth.uid()) and c.kind <> 'PUBLICATION'
  order by c.kind, c.created_at desc, c.id desc
$$;

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
$$;
