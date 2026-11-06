# 07. Поведенческие модели

Диаграммы последовательности для сценариев, где важен порядок шагов и место принятия решения.
Обозначения: **Browser** — браузер, **App** — Next.js (страницы, API, proxy), **DB** — PostgreSQL (функции и
RLS), **Auth** — Supabase Auth, **FD** — football-data.org.

## S1. Вход и выбор псевдонима (UC-01, UC-02)

```mermaid
sequenceDiagram
  autonumber
  actor U as Пользователь
  participant B as Browser
  participant A as App
  participant SA as Auth
  participant GH as GitHub
  participant DB as DB

  U->>B: «Войти через GitHub»
  B->>A: POST /auth/login (Origin, next)
  A->>A: Origin = APP_ORIGIN? оператор задан?
  A->>SA: signInWithOAuth(github, redirectTo=/auth/callback)
  A-->>B: 303 → GitHub + cookie next, consent (httpOnly, 10 мин)
  B->>GH: подтверждение доступа
  GH-->>SA: code
  SA-->>B: 303 → /auth/callback?code
  B->>A: GET /auth/callback
  A->>A: есть cookie согласия?
  A->>SA: exchangeCodeForSession(code)
  A->>DB: record_consents(версия) — от имени пользователя
  A->>DB: профиль с псевдонимом есть?
  A-->>B: 303 → /my/pseudonym?next=…
  U->>B: вводит псевдоним
  B->>A: POST /api/v1/me/pseudonym {name}
  A->>A: проверка правил (быстрый отказ)
  A->>DB: set_pseudonym(name)
  Note over DB: advisory-lock пользователя, правила, совпадение с GitHub,<br/>лимит, INSERT профиля (уникальный индекс),<br/>кошелек, INITIAL_CREDIT 10 000 — одна транзакция
  DB-->>A: {ok, displayName} | {ok:false, code}
  A-->>B: 200 | 409 NAME_TAKEN | 422 …
  B->>B: переход на next (каталог)
```

## S2. Прогноз (UC-04)

```mermaid
sequenceDiagram
  autonumber
  actor P as Игрок
  participant B as Browser
  participant A as App
  participant DB as DB

  P->>B: исход, сумма, «Подтвердить»
  B->>B: новый ключ повтора (UUID) на намерение
  B->>A: POST /api/v1/bets {marketId, outcome, stake, quoteVersion, key}
  A->>A: Origin, вход, JSON ≤ 2 КБ, строгая схема (лишние поля → 400)
  A->>DB: place_bet(...) от имени игрока
  activate DB
  DB->>DB: профиль есть и не отключен? псевдоним?
  DB->>DB: повтор ключа? → вернуть исходный результат (replay)
  DB->>DB: лимит 10/мин
  DB->>DB: FOR UPDATE рынок → матч → кошелек
  DB->>DB: рынок OPEN, матч SCHEDULED, now() < начало − 5 мин,<br/>данные ≤ 60 мин, quote_version совпала, баланс ≥ суммы
  DB->>DB: INSERT bets (коэффициент из рынка), INSERT STAKE_DEBIT, UPDATE balance
  Note over DB: COMMIT → отложенная проверка<br/>«баланс = сумма журнала»
  DB-->>A: {ok, bet, balance, replay}
  deactivate DB
  A-->>B: 201 (или 200 replay) | 4xx/503 с кодом
  B->>B: «Прогноз принят», баланс, обновление страницы
```

Двойной клик: второй запрос с тем же ключом получает исходный прогноз (`replay`), второе списание невозможно —
уникальность `(user_id, idempotency_key)` и `(user_id, market_id)`.

## S3. Задание синхронизации и расчета (UC-07)

```mermaid
sequenceDiagram
  autonumber
  participant CR as pg_cron
  participant A as App /api/internal/jobs/sync
  participant DB as DB (service role)
  participant FD as FD

  CR->>A: POST (Bearer CRON_SECRET), каждые 15 мин
  A->>A: сравнение секрета постоянного времени
  A->>DB: job_acquire_lease(sync, owner, 120 с)
  alt аренда занята
    DB-->>A: null
    A-->>CR: 200 {status: SKIPPED, reason: LEASE_HELD}
  else аренда получена
    DB-->>A: generation N
    A->>DB: job_run_start
    loop PL, BL1, PD
      A->>DB: provider_try_acquire (≤ 8/мин)
      A->>FD: GET /v4/competitions/{id}/matches?dateFrom&dateTo
      FD-->>A: матчи | 429 | ошибка
      A->>DB: sync_upsert_matches (без дубликатов, новее не перетирается)
    end
    A->>DB: sync_close_markets, sync_create_markets (demo-v1)
    A->>DB: sync_confirm_results (второе наблюдение ≥ 10 мин, конфликт → пауза + аудит)
    A->>DB: settle_ready_markets(owner, N, 50)
    Note over DB: для каждого рынка: job_assert_lease (FOR SHARE) →<br/>settle_market, сбой одного → аудит, остальные идут
    A->>DB: job_cleanup
    A->>DB: job_run_finish(OK | PARTIAL | FAILED), job_release_lease
    A-->>CR: 200 {сводка}
  end
```

### Решение расчета одного рынка (`settle_market`)

```mermaid
flowchart TD
  A[Рынок CLOSED или SUSPENDED] --> B{Конфликт итога?}
  B -- да --> SKIP[SKIPPED]
  B -- нет --> C{Итог подтвержден,<br/>FINISHED, REGULAR, счет есть?}
  C -- да --> W[RESOLVED: исход по счету<br/>WON = возможная выплата, LOST = 0]
  C -- нет --> D{Подтверждены<br/>CANCELLED / POSTPONED?}
  D -- да --> V[VOID: возврат суммы]
  D -- нет --> E{Матч и рынок SUSPENDED<br/>и с начала > 48 ч?}
  E -- да --> V
  E -- нет --> SKIP
  W --> J[Выплаты: WIN_CREDIT win:bet,<br/>баланс — в той же транзакции]
  V --> K[Возвраты: VOID_REFUND refund:bet]
```

## S4. Ручной запуск администратором (UC-09)

```mermaid
sequenceDiagram
  autonumber
  actor AD as Администратор
  participant A as App
  participant DB as DB

  AD->>A: POST /api/admin/sync (Origin)
  A->>DB: is_admin() — роль из user_roles, профиль не отключен
  alt не администратор
    A-->>AD: 403
  else администратор
    A->>DB: admin_request_sync() — лимит 1 раз в 5 мин, аудит с автором
    alt лимит
      A-->>AD: 429
    else разрешено
      A->>A: тот же конвейер, что S3 (общая аренда)
      A-->>AD: 200 {сводка}
    end
  end
```

## S5. Удаление аккаунта (UC-10)

```mermaid
sequenceDiagram
  autonumber
  actor P as Игрок
  participant A as App
  participant DB as DB
  participant SA as Auth (admin)

  P->>A: DELETE /api/v1/me/account {confirm}
  A->>A: Origin, вход, confirm = псевдоним?
  A->>DB: delete_my_account() от имени игрока
  Note over DB: имя → «Удалённый игрок», deleted_at, disabled_at,<br/>роли сняты, согласия отозваны, аудит ACCOUNT_DELETED,<br/>повтор — без изменений
  A->>SA: deleteUser(id, мягко)
  alt сбой Auth
    A-->>P: 503 «повторите» (профиль уже отключен, повтор безопасен)
  else
    A->>A: signOut (cookie удалены)
    A-->>P: 200 → главная без входа
  end
```
