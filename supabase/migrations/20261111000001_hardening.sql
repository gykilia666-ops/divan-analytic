-- Hardening (CLAUDE.md §13.5). Этап 10.
-- Ручной запуск синхронизации: 1 раз в 5 минут на всех администраторов (было 1/мин в этапе 9 —
-- расхождение с §13.5 найдено при ревью). Функция заменяется целиком; права сохраняются.
create or replace function public.admin_request_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert();
  if not public.rate_limit_hit('admin:sync', 1, 300) then
    return jsonb_build_object('ok', false, 'code', 'RATE_LIMITED');
  end if;
  insert into public.audit_events (kind, user_id, details)
  values ('ADMIN_SYNC_REQUESTED', (select auth.uid()), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Ускорение очереди расчета и обзора админки на профиле 2 000 матчей (§14.1).
create index if not exists markets_status_idx on public.markets (status) where status in ('OPEN', 'CLOSED', 'SUSPENDED');
create index if not exists audit_events_kind_created_idx on public.audit_events (kind, created_at desc);
