# 08. Интеграции

## Сводка

| Система                          | Назначение                   | Направление           | Протокол, аутентификация                                   | Критичность                                           |
| -------------------------------- | ---------------------------- | --------------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| football-data.org v4             | матчи, статусы, счет         | исходящий             | HTTPS REST, заголовок `X-Auth-Token`                       | высокая: без нее нет новых матчей и расчетов          |
| GitHub OAuth                     | идентификация пользователя   | через Supabase Auth   | OAuth 2.0 Authorization Code                               | высокая: единственный способ входа                    |
| Supabase Auth                    | сессии, учетные записи       | входящий/исходящий    | JWT в cookie (`@supabase/ssr`), admin API                  | высокая                                               |
| Supabase PostgreSQL              | данные и бизнес-логика       | исходящий             | PostgREST (RLS по JWT), service role только для задания    | высокая                                               |
| Supabase Cron (pg_cron + pg_net) | запуск задания каждые 15 мин | входящий в приложение | HTTPS POST, `Authorization: Bearer CRON_SECRET` (из Vault) | средняя: без нее данные устаревают, прием закрывается |
| Vercel                           | хостинг, функции `lhr1`      | —                     | Git-деплой из `main`                                       | высокая                                               |

## 1. football-data.org

**Тариф Free:** 10 запросов в минуту, 12 соревнований, данные с задержкой, без live. Внутренний бюджет приложения —
8 запросов в минуту (запас на ручные запросы владельца).

### Запрос

`GET https://api.football-data.org/v4/competitions/{id}/matches?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD`

| Соревнование               | `id` | Код в системе |
| -------------------------- | ---- | ------------- |
| Premier League             | 2021 | PL            |
| Bundesliga                 | 2002 | BL1           |
| Primera Division (La Liga) | 2014 | PD            |

Окно дат — от нескольких дней назад (дозагрузка итогов) до недели вперед. Один запрос на соревнование за запуск.

### Сопоставление данных

| Поле поставщика                                         | Поле системы                        | Правило                                                                      |
| ------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| `id`                                                    | `matches.provider_id`               | вместе с `provider = 'football-data'` — уникальный ключ                      |
| `utcDate`                                               | `kickoff_at`                        | только время с зоной; без зоны — элемент отбрасывается                       |
| `homeTeam`, `awayTeam`                                  | `teams`                             | upsert по `id` команды                                                       |
| `lastUpdated`                                           | `provider_updated_at`               | более старые данные не перезаписывают более новые                            |
| `status`                                                | `status`                            | см. таблицу ниже; неизвестный статус — элемент отбрасывается, не угадывается |
| `score.duration`, `score.fullTime`, `score.regularTime` | `regulation_*_score`, `result_kind` | см. правило итога                                                            |

| Статус поставщика                                     | Статус системы |
| ----------------------------------------------------- | -------------- |
| `SCHEDULED`, `TIMED`                                  | `SCHEDULED`    |
| `IN_PLAY`, `PAUSED`, `EXTRA_TIME`, `PENALTY_SHOOTOUT` | `LIVE`         |
| `FINISHED`, `AWARDED`                                 | `FINISHED`     |
| `SUSPENDED`                                           | `SUSPENDED`    |
| `POSTPONED`                                           | `POSTPONED`    |
| `CANCELLED`                                           | `CANCELLED`    |

**Правило итога основного времени (BRL-18):**

- `FINISHED` и `duration = REGULAR`: `fullTime` — итог основного времени; нет счета — итога еще нет (`NONE`);
  неполный счет — `AMBIGUOUS`.
- `FINISHED` и дополнительное время или пенальти: берется только `regularTime`; если его нет — `AMBIGUOUS`.
- `AWARDED` (технический результат) — всегда `AMBIGUOUS`: игровой счет основного времени не сыгран.

### Обработка ошибок

| Ситуация                  | Поведение                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 429                       | пауза до времени из ответа (`next_allowed_at`), остальные лиги в этом запуске не запрашиваются; итог `PARTIAL` |
| 401/403                   | ошибка конфигурации токена; повторы не помогут — видно в `/admin`, runbook                                     |
| таймаут (10 с), сеть, 5xx | ошибка по лиге, сохраненные данные не трогаются, итог `PARTIAL`; следующий запуск догоняет                     |
| некорректный элемент      | отбрасывается и считается в `invalid`, остальные сохраняются                                                   |

**Контрактные тесты:** разбор проверяется на сохраненном ответе поставщика (`tests/fixtures/football-data`); CI
внешний API не вызывает. Условия поставщика: ссылка на football-data.org в подвале; эмблемы клубов и лиг не
используются.

## 2. GitHub OAuth через Supabase Auth

- Отдельные OAuth-приложения для локальной разработки и production. Redirect URI в GitHub — callback Supabase
  (`https://<ref>.supabase.co/auth/v1/callback`); в Supabase — Site URL и Redirect URL сайта
  (`https://divan-analytic.vercel.app/auth/callback`).
- Почтовый вход в Supabase выключен; пароли не хранятся.
- Из данных GitHub в приложении используются только идентификатор учетной записи (`auth.users.id`) и, для
  запрета совпадения псевдонима, логин, имя и часть почты до `@` — внутри функции БД. В профиль и ответы они не
  копируются.
- Сессия: JWT доступа (1 ч) и refresh-токен в cookie; `proxy.ts` обновляет сессию на каждом запросе; RLS в БД
  получает пользователя из JWT (`auth.uid()`).
- Удаление аккаунта мягко удаляет учетную запись (`auth.admin.deleteUser(id, true)`): строка остается для
  внешних ключей, вход невозможен.

## 3. Расписание (Supabase Cron)

- Задание `divan-sync`, `*/15 * * * *`: `net.http_post` на `https://divan-analytic.vercel.app/api/internal/jobs/sync`
  с `Authorization: Bearer <divan_cron_secret>`; адрес и секрет — в Supabase Vault, не в коде.
- Таймаут HTTP — 60 с (меньше аренды задания 120 с и лимита функции Vercel 60 с).
- Контроль: `cron.job_run_details`, `net._http_response` (ожидается 200), `public.job_runs`, страница `/admin`.
- Отключение: `select cron.unschedule('divan-sync');` Шаблон — `supabase/cron/schedule-sync.sql`.

## 4. Vercel

- Деплой из ветки `main`; Preview-сборки — в режиме demo без доступа к рабочей БД (переменные `connected` заданы
  только для Production).
- Регион функций `lhr1` (`vercel.json`) рядом с БД `eu-west-2`.
- Переменные Production: `APP_DATA_MODE`, `SPORTS_PROVIDER`, `APP_ORIGIN`, `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `LEGAL_OPERATOR_NAME`, `LEGAL_OPERATOR_EMAIL` (Config);
  `SUPABASE_SERVICE_ROLE_KEY`, `FOOTBALL_DATA_API_KEY`, `CRON_SECRET` (Secret). Порядок выпуска — [deploy.md](../deploy.md).
