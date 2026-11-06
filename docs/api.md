# HTTP API

Справочник по маршрутам приложения (docs/requirements.md §11). Для тех, кто пишет клиент, тест или разбирает инцидент.
Страницы сайта используют те же серверные функции напрямую, без HTTP-круга.

## Общие правила

**Формат ответа.** Успех — `{ "data": …, "meta": { "requestId": "uuid", … } }`. Ошибка —
`{ "error": { "code": "…", "message": "…", "requestId": "uuid" } }`. Сообщение можно показывать
пользователю; подробностей БД, стека и ключей в ответах нет. `requestId` совпадает с полем в логах сервера.

**Вход.** Сессия Supabase в cookie (`sb-<ref>-auth-token`), выдается после входа через GitHub. Отдельных
API-ключей для клиентов нет. Без сессии приватные маршруты отвечают `401 UNAUTHENTICATED`.

**Изменяющие запросы** (`POST`, `DELETE`) принимаются только с заголовком `Origin`, равным `APP_ORIGIN`
(`https://divan-analytic.vercel.app`). Без него или с другим адресом — `403 FORBIDDEN`, до проверки входа и
обращения к БД. Тело — JSON с `Content-Type: application/json`, размер ограничен (от 512 байт до 2 КБ по
маршруту); лишние поля отклоняются.

**Режим demo.** Приватные и изменяющие маршруты в demo недоступны (`404` или `503`), публичные отдают
демонстрационные данные с `meta.source: "demo"`.

**Кеш.** Публичные чтения: `Cache-Control: public, s-maxage=30` (матчи) и `s-maxage=60` (рейтинг). Все
приватные ответы и ошибки — `no-store`.

**Время** — ISO 8601 в UTC. **Коэффициенты** — целые «милли»: `2350` = 2.35. **Монеты** — целые числа.

### Коды ошибок

| HTTP | Код                                                | Когда                                                                          |
| ---- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| 400  | `VALIDATION_ERROR`                                 | некорректный JSON, лишние или неверные поля, слишком большое тело              |
| 400  | `CONFIRMATION_MISMATCH`                            | удаление аккаунта: подтверждение не совпало                                    |
| 401  | `UNAUTHENTICATED`                                  | нет сессии                                                                     |
| 403  | `FORBIDDEN`                                        | чужой Origin; нет роли администратора                                          |
| 403  | `ACCOUNT_DISABLED`                                 | аккаунт отключен или удален                                                    |
| 403  | `PSEUDONYM_REQUIRED`                               | прогноз до выбора псевдонима                                                   |
| 404  | `NOT_FOUND`                                        | нет матча или рынка; маршрут недоступен в этом режиме                          |
| 409  | `MARKET_CLOSED`                                    | прием на матч закрыт (меньше 5 минут до начала, рынок не открыт)               |
| 409  | `QUOTE_CHANGED`                                    | коэффициенты изменились, пока пользователь оформлял прогноз                    |
| 409  | `ALREADY_PLACED`                                   | прогноз на этот матч уже есть                                                  |
| 409  | `IDEMPOTENCY_CONFLICT`                             | тот же ключ повтора с другими данными                                          |
| 409  | `NAME_TAKEN`, `ALREADY_SET`                        | псевдоним занят; псевдоним уже выбран                                          |
| 409  | `NO_CONFLICT`                                      | админка: у матча нет конфликта результата                                      |
| 422  | `INSUFFICIENT_BALANCE`                             | не хватает монет                                                               |
| 422  | `INVALID_NAME`, `RESERVED_NAME`, `MATCHES_ACCOUNT` | псевдоним не по правилам, зарезервирован или совпадает с данными GitHub        |
| 429  | `RATE_LIMITED`                                     | лимит частоты (прогнозы 10/мин, псевдоним 10/мин, ручной запуск 1 раз в 5 мин) |
| 503  | `DATA_STALE`                                       | данные матча старше 60 минут — прием временно закрыт                           |
| 503  | `SERVICE_UNAVAILABLE`                              | сбой БД или поставщика; повтор безопасен                                       |

## Публичные маршруты

### `GET /api/health`

Минимальная проверка, без обращений к БД и поставщику. `200 { "data": { "status": "ok" } }`, `no-store`.

### `GET /api/v1/matches`

Каталог матчей. Параметры (все необязательны):

| Параметр      | Значение                                                   |
| ------------- | ---------------------------------------------------------- |
| `scope`       | `upcoming` (по умолчанию), `finished`, `all`               |
| `competition` | код соревнования: `PL`, `BL1`, `PD`                        |
| `date`        | `YYYY-MM-DD` — день в зоне `tz`                            |
| `tz`          | IANA-зона, например `Asia/Novosibirsk`; по умолчанию `UTC` |
| `limit`       | 1–100, по умолчанию 20                                     |
| `cursor`      | значение `nextCursor` из предыдущего ответа                |

```json
{
  "data": {
    "items": [
      {
        "id": "uuid",
        "competition": { "code": "PL", "name": "Premier League" },
        "home": "Everton FC",
        "away": "Coventry City FC",
        "kickoffAt": "2026-11-06T20:00:00.000Z",
        "status": "SCHEDULED",
        "homeScore": null,
        "awayScore": null,
        "resultKind": "NONE",
        "lastSeenAt": "2026-11-06T18:45:03.000Z",
        "stale": false,
        "market": {
          "id": "uuid",
          "status": "OPEN",
          "quoteVersion": 1,
          "modelVersion": "demo-v1",
          "odds": { "home": 1830, "draw": 4340, "away": 3500 }
        },
        "acceptance": {
          "accepting": true,
          "reason": "OPEN",
          "closesAt": "2026-11-06T19:55:00.000Z"
        },
        "note": null
      }
    ],
    "nextCursor": "…",
    "competitions": [{ "code": "PL", "name": "Premier League" }]
  },
  "meta": { "requestId": "uuid", "lastSyncedAt": "…", "now": "…", "source": "database" }
}
```

`acceptance.reason`: `OPEN`, `NO_MARKET`, `MARKET_NOT_OPEN`, `MATCH_NOT_SCHEDULED`, `CUTOFF` (меньше
5 минут до начала), `STALE` (данные старше 60 минут). Окончательное решение о приеме все равно принимает БД.

### `GET /api/v1/matches/:id`

Один матч в том же формате, что элемент `items`. `404 NOT_FOUND`, если матча нет.

### `GET /api/v1/leaderboard`

```json
{
  "data": {
    "minSettled": 5,
    "entries": [
      {
        "place": 1,
        "displayName": "Тихий Форвард",
        "avatarUrl": null,
        "settled": 12,
        "won": 7,
        "stakes": 1200,
        "netProfit": 340,
        "winRate": 58.33,
        "roi": 28.33
      }
    ]
  },
  "meta": { "requestId": "uuid", "source": "db", "generatedAt": "…" }
}
```

Игроки с псевдонимом и 5+ рассчитанными прогнозами; порядок — `netProfit`, затем `settled`. Только безопасные
поля: без идентификаторов, почты и баланса. `winRate` и `roi` — проценты или `null`.

## Личные маршруты (нужен вход)

### `GET /api/v1/me`

`{ "id": "uuid", "displayName": "Тихий Форвард" | null, "avatarUrl": null }`. `displayName: null` — псевдоним
еще не выбран (профиля нет).

### `POST /api/v1/me/pseudonym`

Выбор псевдонима — один раз (ADR-073). Создает профиль, кошелек и начисляет 10 000 монет (ADR-075).

```http
POST /api/v1/me/pseudonym
Origin: https://divan-analytic.vercel.app
Content-Type: application/json

{ "name": "Тихий Форвард" }
```

`200 { "displayName": "Тихий Форвард" }`. Правила: 3–24 символа, русские и латинские буквы, цифры, пробел,
`.`, `_`, `-`, начало с буквы или цифры; не совпадает с логином или именем GitHub. Ошибки: `422 INVALID_NAME`,
`RESERVED_NAME`, `MATCHES_ACCOUNT`; `409 NAME_TAKEN`, `ALREADY_SET`; `429 RATE_LIMITED`. Повтор того же имени
(двойная отправка) — успех без изменений.

### `POST /api/v1/bets`

Прогноз. Решение принимает функция БД `place_bet` в одной транзакции.

```json
{
  "marketId": "uuid",
  "outcome": "HOME",
  "stake": 100,
  "quoteVersion": 1,
  "idempotencyKey": "uuid"
}
```

- `outcome`: `HOME`, `DRAW`, `AWAY`; `stake`: целое 10–1000; `quoteVersion` — из `market.quoteVersion`.
- `idempotencyKey` — новый UUID на каждое намерение. Повтор с тем же ключом и теми же данными (сеть оборвалась,
  двойной клик) возвращает исходный прогноз: `200` и `replay: true`, второго списания нет.
- `201` — принят:

```json
{
  "data": {
    "bet": {
      "id": "uuid",
      "marketId": "uuid",
      "outcome": "HOME",
      "stake": 100,
      "acceptedOddsMilli": 1830,
      "potentialPayout": 183,
      "status": "PENDING",
      "createdAt": "…"
    },
    "balance": 9900,
    "replay": false
  }
}
```

`potentialPayout = floor(stake × odds / 1000)` и включает сумму прогноза. Ошибки — см. таблицу кодов.

### `GET /api/v1/me/bets`

История, новые сверху. Параметры: `status` (`PENDING`, `WON`, `LOST`, `VOID`), `limit` (1–100, по умолчанию 20),
`cursor`. Ответ: `{ "items": [ … ], "nextCursor": "…" | null }`; элемент — прогноз с `actualPayout`,
`settledAt` и `match: { id, kickoffAt, competition, home, away, homeScore, awayScore }`.

### `GET /api/v1/me/stats`

```json
{
  "stats": {
    "won": 3,
    "lost": 2,
    "void": 1,
    "pending": 1,
    "stakes": 500,
    "payouts": 600,
    "settled": 5,
    "profit": 100,
    "winRate": 60,
    "roi": 20
  },
  "place": 7
}
```

Учитываются только `WON` и `LOST`; `VOID` и `PENDING` — отдельно. `place: null` — меньше 5 рассчитанных.

### `DELETE /api/v1/me/account`

Удаление аккаунта (ADR-061, ADR-075): профиль обезличивается, вход по учетной записи закрывается, сессия
завершается; журнал операций и прогнозы остаются без имени.

```json
{ "confirm": "Тихий Форвард" }
```

`confirm` — точный псевдоним (или слово «удалить», если псевдоним не выбран). `200 { "deleted": true }`;
`400 CONFIRMATION_MISMATCH`. Повтор безопасен.

## Вход

| Маршрут              | Что делает                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`   | форма со страницы входа (`next` — куда вернуть); фиксирует согласие с документами и отправляет на GitHub. Закрыт (`503`), пока не заданы `LEGAL_OPERATOR_*` |
| `GET /auth/callback` | возврат из GitHub: обмен кода на сессию, запись согласий, переход на выбор псевдонима или на `next`                                                         |
| `POST /auth/signout` | выход, затем переход на главную                                                                                                                             |

Все три — только в режиме connected; `POST` — с проверкой Origin.

## Служебные маршруты

### `POST /api/internal/jobs/sync`

Конвейер синхронизации и расчета для расписания (Supabase Cron, каждые 15 минут).
`Authorization: Bearer <CRON_SECRET>`; без него `401`. Ответ — сводка запуска:

```json
{
  "status": "OK",
  "generation": 42,
  "sync": { "status": "ok", "requests": 3, "fetched": 31, "inserted": 0, "updated": 31 },
  "markets": { "closed": 2, "created": 4 },
  "results": { "observed": 3, "confirmed": 2, "conflicts": 0 },
  "settlement": { "resolved": 2, "void": 0, "skipped": 0, "failed": 0 },
  "cleanup": { "jobRuns": 0, "rateLimitBuckets": 12 },
  "errors": []
}
```

`status`: `OK`, `PARTIAL` (часть шагов не удалась — следующий запуск догонит), `SKIPPED` (`reason: "LEASE_HELD"`,
идет другой запуск), `FAILED`. Разбор — docs/runbook.md.

### Админка (роль `ADMIN`)

| Маршрут                     | Что делает                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/jobs`       | обзор: последний успех и ошибка, аренда, запуски, запросы к поставщику, очередь расчета с причиной ожидания   |
| `POST /api/admin/sync`      | ручной запуск конвейера; не чаще раза в 5 минут на всех (`429`); тело `{}`                                    |
| `POST /api/admin/conflicts` | снять паузу конфликта результата: `{ "matchId": "uuid", "note": "причина от 5 символов" }`; `409 NO_CONFLICT` |

Без входа — `401`, без роли — `403` (роль проверяется в БД при каждом запросе, ADR-052).

## Проверки

Обертка маршрутов покрыта `tests/unit/routes-http.test.ts` (Origin, вход, роль, разбор тела, коды), полный путь —
`tests/e2e-connected/user-journey.spec.ts`. Новый изменяющий маршрут добавляется строкой в таблицу первого теста.
