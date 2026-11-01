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
