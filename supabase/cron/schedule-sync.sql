-- Расписание синхронизации и расчета (docs/requirements.md §10.2). НЕ миграция: выполняется вручную в SQL Editor
-- production-проекта Supabase, потому что содержит адрес приложения и секрет.
-- Перед запуском замените две строки REPLACE_ME. Секреты хранятся в Vault, не в коде и не в cron.job.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Секреты (один раз). Повторный запуск create_secret с тем же именем вернет ошибку — тогда
--    используйте vault.update_secret(id, new_secret).
select vault.create_secret(
  'https://REPLACE_ME.vercel.app/api/internal/jobs/sync',
  'divan_sync_url',
  'Divan: адрес задания синхронизации'
);
select vault.create_secret(
  'REPLACE_ME_WITH_CRON_SECRET',
  'divan_cron_secret',
  'Divan: Bearer-секрет задания (тот же, что CRON_SECRET в Vercel)'
);

-- 2. Каждые 15 минут: POST с Bearer-секретом. Таймаут меньше аренды задания (120 с).
select cron.schedule(
  'divan-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'divan_sync_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'divan_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Проверка:
--   select jobid, jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, created from net._http_response order by created desc limit 5;
--   select status, started_at, summary from public.job_runs order by started_at desc limit 5;
-- Отключить: select cron.unschedule('divan-sync');
