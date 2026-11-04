# Диванный аналитик

Учебный симулятор спортивных прогнозов на футбол. Монеты виртуальные и не имеют денежной стоимости,
коэффициенты демонстрационные, спортивные данные могут поступать с задержкой.

> Статус: **этап 1 из 11** (каркас и demo shell). Прогнозы, вход и расчёт ещё не реализованы.
> Требования, архитектура и журнал прогресса — в [`CLAUDE.md`](./CLAUDE.md).

## Быстрый старт (demo, без ключей)

Нужны Node.js 22 (`.nvmrc`) и npm.

```bash
npm install          # создаст package-lock.json — закоммитьте его
npm run format       # один раз: код написан без запуска Prettier
npm run check        # format:check + lint + typecheck + unit-тесты
npm run dev          # http://localhost:3000
```

Production-сборка и e2e (Playwright):

```bash
npm run build
npx playwright install chromium
npm run e2e          # поднимает `next start` на порту 3100 в режиме demo
```

## Режимы окружения

| Переменная        | Значения                     | По умолчанию |
| ----------------- | ---------------------------- | ------------ |
| `APP_DATA_MODE`   | `demo` / `connected`         | `demo`       |
| `SPORTS_PROVIDER` | `fixtures` / `football-data` | `fixtures`   |

- `demo` не требует никаких ключей и допускает только `fixtures`.
- `connected` требует Supabase, `APP_ORIGIN` и отдельный `CRON_SECRET` (≥ 32 символов).
- `football-data` требует `FOOTBALL_DATA_API_KEY` и режим `connected`.
- Противоречивые комбинации и секреты через `NEXT_PUBLIC_*` отклоняются при старте.

Примеры — в `.env.example`. Реальные `.env*` не коммитить.

## Структура

```
src/app/            страницы и API (App Router)
src/components/     UI
src/lib/            env, время
src/fixtures/       демонстрационные данные (вымышленные клубы)
tests/unit/         Vitest
tests/e2e/          Playwright
```

## Ограничения этапа 1

- shadcn/ui не подключён (добавим `npx shadcn@latest init`, когда появятся формы и купон).
- CSP не настроен (этап 10, вместе с OAuth).
- Шаг `npm audit` в CI информационный: политика не согласована.

## База данных (локальный Supabase, этап 2)

Нужны Docker Desktop (запущенный) и Supabase CLI (ставится как devDependency).

```bash
npx supabase init            # один раз: создаст supabase/config.toml (VS Code settings — "n")
npm run db:start             # первый запуск скачивает образы (несколько минут)
npm run db:reset             # применяет все миграции с нуля
npm run db:test              # pgTAP: ограничения, RLS, инициализация кошелька
npm run test:integration     # конкурентность (20 параллельных вызовов)
npm run db:stop
```

Миграции лежат в `supabase/migrations`, SQL-тесты — в `supabase/tests/database`.
Права по умолчанию отозваны у `anon` и `authenticated`: каждая новая таблица и функция
получает grants явно (см. комментарий в `20261102000004_rls_grants.sql`).

## Вход через GitHub (этап 3, режим connected)

Нужны локальный Supabase (`npm run db:start`), GitHub OAuth App и файл `.env.local`
(`APP_DATA_MODE=connected`, `APP_ORIGIN=http://localhost:3000`, ключи Supabase).
Открывайте приложение по `http://localhost:3000` (не `127.0.0.1`): Origin проверяется строго по `APP_ORIGIN`.

- `POST /auth/login` — запуск OAuth; `GET /auth/callback` — обмен кода и инициализация кошелька;
  `POST /auth/signout` — выход.
- Защищенные страницы и API проверяют пользователя на сервере через `getClaims()`.
- В режиме demo вход отключен, эндпоинты отвечают 503/404.

## Синхронизация матчей (этап 4)

Поставщик выбирается `SPORTS_PROVIDER`: `fixtures` (без сети, по умолчанию) или `football-data`
(нужен `FOOTBALL_DATA_API_KEY` и режим `connected`). Соревнования MVP: PL, BL1, PD.

Ручной запуск (локально, при запущенном `npm run dev` и локальном Supabase):

```powershell
$secret = (Select-String -Path .env.local -Pattern '^CRON_SECRET=(.+)$').Matches[0].Groups[1].Value
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/internal/jobs/sync `
  -Headers @{ Authorization = "Bearer $secret" } | ConvertTo-Json -Depth 5
```

- Один запрос на соревнование, общий лимитер в БД (≤ 8 запросов в минуту), 429 сохраняет паузу.
- Повторный импорт не создает дубликатов; более старые данные не перезаписывают более новые.
- Сбой поставщика не трогает уже сохраненные матчи.
- CI внешний API не вызывает: тесты используют fixtures и сохраненную форму ответа.

## Матчи и рынки (этап 5)

- `/matches` — каталог с фильтрами (соревнование, предстоящие/завершённые, дата, часовой пояс) и пагинацией;
  `/matches/[id]` — страница матча. API: `GET /api/v1/matches`, `GET /api/v1/matches/:id`.
- Коэффициенты демонстрационные и детерминированные (`demo-v1`), считаются на сервере при создании рынка.
- Прием прогнозов закрывается за 5 минут до начала и при данных старше 60 минут — по часам PostgreSQL,
  даже если синхронизация еще не закрыла рынок.
- Полная локальная проверка: `powershell -ExecutionPolicy Bypass -File scripts\verify.ps1`.

## Прогнозы (этап 6)

- Купон на странице матча (после входа): исход, сумма 10–1000 монет, возможная выплата.
- `POST /api/v1/bets` → функция БД `place_bet`: одна транзакция, идемпотентность по ключу, лимит
  10 попыток в минуту, проверка времени, свежести и версии котировки по часам PostgreSQL.
- История: `/my/bets`, `GET /api/v1/me/bets`. В демо-режиме прогнозы не принимаются.

## Расчет и автообновление (этап 7)

- Задание `POST /api/internal/jobs/sync` (Bearer `CRON_SECRET`) за один запуск: загружает матчи, закрывает
  и создает рынки, подтверждает итоги (два одинаковых наблюдения с интервалом ≥ 10 минут) и рассчитывает
  прогнозы: выигрыш, проигрыш или возврат при отмене/переносе. Повторный расчет ничего не начисляет.
- Одновременно работает только один запуск (аренда с поколением); история — таблица `job_runs`.
- Расписание каждые 15 минут: `supabase/cron/schedule-sync.sql` (облачный Supabase, секреты в Vault).
- Разбор сбоев и ручная компенсация: `docs/runbook.md`.
