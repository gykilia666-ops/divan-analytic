# Выпуск в production

Порядок из docs/requirements.md §19.2 в том виде, как он выполнен для https://divan-analytic.vercel.app (2026-11-05).
Секреты нигде не записываются в репозиторий и не передаются в чат: только в настройки сервисов и менеджер паролей.

## 1. Supabase

1. Новый проект на Free-плане. Регион — рядом с функциями Vercel (здесь `eu-west-2` London ↔ Vercel `lhr1`).
   Пароль БД — в менеджер паролей.
2. Миграции — вручную, из чистого рабочего дерева на коммите, который будет задеплоен:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push --linked        # покажет список и спросит подтверждение
   ```
   Не применять миграции из сборки Next.js: preview-деплои не должны менять схему.

## 2. Вход через GitHub

1. Отдельный GitHub OAuth App для production: Homepage — адрес сайта, Redirect URI —
   `https://<ref>.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Providers: GitHub включен (Client ID/Secret), **Email выключен** (иначе
   регистрация в обход GitHub со стартовыми монетами).
3. Authentication → URL Configuration: Site URL — адрес сайта; Redirect URLs — `https://<сайт>/auth/callback`.
   Если оставить Site URL по умолчанию, после входа пользователя вернет на `localhost:3000`.

## 3. Vercel

Переменные — **только для Production** (Preview остается demo):

| Переменная                                                                                       | Тип                              |
| ------------------------------------------------------------------------------------------------ | -------------------------------- |
| `APP_DATA_MODE=connected`, `SPORTS_PROVIDER=football-data`, `APP_ORIGIN=https://<сайт>`          | Config                           |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                               | Config (публичные по назначению) |
| `SUPABASE_SERVICE_ROLE_KEY` (secret key), `FOOTBALL_DATA_API_KEY`, `CRON_SECRET` (≥ 32 символов) | Secret                           |
| `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_EMAIL`                                                    | Config (данные оператора ПДн)    |

Без `LEGAL_OPERATOR_*` вход закрыт намеренно (503): политика обязана называть оператора. Миграции (включая
`20261113000001_legal_consents.sql`, `20261114000001_pseudonyms.sql`, `20261115000001_user_chosen_pseudonym.sql`, `20261116000001_pseudonym_once.sql`, `20261117000001_bets_need_pseudonym.sql`, `20261118000001_profile_on_pseudonym.sql`, `20261119000001_remove_publication_consent.sql`) применяются **до** выпуска кода. Остальное по юридической части —
[`legal-checklist.md`](./legal-checklist.md).

Регион функций задан в `vercel.json` (`lhr1`). `NEXT_PUBLIC_*` встраиваются при сборке — после их изменения
нужен новый деплой.

## 4. Проверка после деплоя

1. `GET /api/health` → 200; на сайте плашка «Режим connected».
2. Вход через GitHub с основного домена.
3. Роль администратора (`supabase/admin/grant-admin.sql` в SQL Editor), `/admin` → «Запустить синхронизацию» → OK.
4. Матчи и коэффициенты на `/matches`, прогноз, баланс и журнал в `/my/wallet`.

## 5. Расписание

`supabase/cron/schedule-sync.sql` в SQL Editor: адрес задания и тот же `CRON_SECRET` — в Vault. Замены делать
в редакторе, не в файле; после запуска удалить сохраненный запрос. Проверка через 15–20 минут:

```sql
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 3;
select status_code, created from net._http_response order by created desc limit 3;
```

Ожидается `succeeded` и `200`, в `/admin` — новые запуски примерно каждые 15 минут.

## Откат

Откат деплоя в Vercel (Promote предыдущего) не откатывает БД. Миграции — только расширяющие и обратно
совместимые (expand/contract): старый код должен работать на новой схеме. Перед рискованной миграцией —
резервная копия (см. runbook).
