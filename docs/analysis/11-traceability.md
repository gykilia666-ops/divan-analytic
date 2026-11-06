# 11. Матрица трассируемости

Связь «бизнес-требование → правило → функциональное требование → сценарий и история → реализация → тесты».
Пути — от корня репозитория. Проверено на релизе 7c4410b (CI #16: unit 278, pgTAP ~425, интеграция 16,
e2e demo 154, e2e connected 5).

## Покрытие

| Группа                 | Всего | ✅ авто | ◐ вручную | ○ план |
| ---------------------- | ----- | ------- | --------- | ------ |
| Функциональные (FR)    | 67    | 62      | 5         | 0      |
| Нефункциональные (NFR) | 18    | 13      | 4         | 1      |

Требования с ручной проверкой: FR-AUTH-01 и FR-AUTH-09 (настоящий GitHub OAuth и выход — внешняя система),
FR-WAL-04, FR-SYNC-01 (расписание в облаке — проверено по `job_runs`), FR-ACC-04; NFR-01 (облачные замеры),
NFR-13, NFR-14, NFR-17. План: NFR-04 (реакция интерфейса ≤ 100 мс).

## Бизнес-требования → требования

| BR    | Правила            | FR / NFR                                                |
| ----- | ------------------ | ------------------------------------------------------- |
| BR-01 | BRL-05…13, 16      | FR-CAT-_, FR-BET-_, FR-WAL-01                           |
| BR-02 | BRL-13, 14, 15, 21 | FR-BET-02, 04, FR-WAL-02, 03, FR-SET-04; NFR-05, NFR-06 |
| BR-03 | BRL-17…20          | FR-SYNC-_, FR-SET-_                                     |
| BR-04 | BRL-03, 04, 22…24  | FR-PSN-_, FR-STAT-_, FR-LB-*; NFR-11                    |
| BR-05 | BRL-20, 25, 26     | FR-ADM-*; NFR-12                                        |
| BR-06 | BRL-27…29          | FR-AUTH-03…05, FR-ACC-_, FR-LEG-_; NFR-10, NFR-11       |
| BR-07 | BRL-30             | FR-SYNC-02; NFR-01…03                                   |
| BR-08 | BRL-01             | FR-DEMO-*; NFR-15, NFR-16                               |

## Требования → реализация → тесты

| Требования                 | UC / US                     | Реализация                                                                                                                                                                                            | Тесты                                                                                                                                                                                                                   |
| -------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-AUTH-01…09              | UC-01, UC-12 / US-01, US-02 | `src/app/auth/{login,callback,signout}/route.ts`, `src/proxy.ts`, `src/server/auth/*`, `src/lib/safe-redirect.ts`, `src/lib/origin.ts`, `src/app/login/page.tsx`                                      | unit `safe-redirect`, `origin`, `consent`, `legal`; pgTAP `12_consents`; e2e `auth-demo`, `legal`, `security`                                                                                                           |
| FR-PSN-01…06               | UC-02 / US-03, US-04        | миграции `20261114…20261118`; `src/lib/pseudonym.ts`; `src/server/account/pseudonym.ts`; `src/app/api/v1/me/pseudonym/route.ts`; `src/app/my/pseudonym/page.tsx`                                      | unit `pseudonym`, `routes-http`; pgTAP `13_pseudonyms`; интеграция `wallet-init.concurrency` (гонка за имя); e2e connected `user-journey`                                                                               |
| FR-CAT-01…07               | UC-03 / US-05, US-06        | миграции `20261105`, `20261107`; `src/server/catalog/*`; `src/domain/markets/acceptance.ts`; `src/components/matches/*`; `src/app/matches/*`                                                          | unit `catalog-query`, `catalog-row`, `demo-catalog`, `acceptance`, `day-range`, `date-range`, `time`; pgTAP `05_catalog_markets`; e2e `catalog`, `smoke`                                                                |
| FR-BET-01…07               | UC-04, UC-05 / US-07…10     | миграции `20261106`, `20261117`; `src/server/betting/*`; `src/domain/betting/coupon.ts`; `src/components/betting/*`; `src/app/api/v1/bets/route.ts`; `src/app/my/bets/page.tsx`                       | pgTAP `06_place_bet`; интеграция `place-bet.concurrency`; unit `coupon`, `bet-contract`, `routes-http`; e2e `betting-demo`, connected `user-journey` (двойной клик, повтор)                                             |
| FR-WAL-01…04               | UC-05 / US-10               | миграции `20261102000001…3` (журнал, триггеры); `src/app/my/wallet/page.tsx`                                                                                                                          | pgTAP `01_constraints`, `03_wallet_init`; e2e connected `user-journey`                                                                                                                                                  |
| FR-SYNC-01…07              | UC-07, UC-09                | миграция `20261104`, `20261108`; `src/server/providers/*`; `src/server/jobs/{sync-matches,markets,pipeline,execute}.ts`; `src/app/api/internal/jobs/sync/route.ts`; `supabase/cron/schedule-sync.sql` | unit `football-data-*`, `fixtures-provider`, `sync-matches`, `upsert-payload`, `markets-job`, `sync-pipeline`, `cron-auth`, `demo-odds`; pgTAP `04_sync`; интеграция `sync-rate-limit.concurrency`; облако — `job_runs` |
| FR-SET-01…06               | UC-07 / US-11…13            | миграция `20261108_settlement_jobs` (`sync_confirm_results`, `settle_market`, `settle_ready_markets`, аренда)                                                                                         | pgTAP `07_settlement`; интеграция `settlement.concurrency`; e2e connected `user-journey` (расчет 3:2)                                                                                                                   |
| FR-STAT-01…03, FR-LB-01…03 | UC-06 / US-14, US-15        | миграция `20261109`; `src/domain/stats/stats.ts`; `src/server/stats/index.ts`; `src/lib/ttl-cache.ts`; `src/app/{my/stats,leaderboard}/page.tsx`                                                      | unit `stats`, `demo-leaderboard`, `ttl-cache`; pgTAP `08_stats` (пересчет прямым SQL); e2e `leaderboard`, connected `user-journey`                                                                                      |
| FR-ACC-01…04               | UC-10 / US-16               | миграции `20261112`, `20261113`, `20261118`; `src/server/account/delete-account.ts`; `src/app/api/v1/me/account/route.ts`; `src/app/my/account/page.tsx`                                              | pgTAP `11_account_deletion`; unit `routes-http`; e2e `account`, connected `user-journey`                                                                                                                                |
| FR-ADM-01…05               | UC-08, UC-09 / US-18…20     | миграции `20261110`, `20261111`; `src/server/admin/*`; `src/domain/admin/wait-reason.ts`; `src/app/api/admin/*`; `src/app/admin/page.tsx`                                                             | pgTAP `09_admin`, `10_hardening`; unit `wait-reason`, `routes-http`; e2e `admin`, connected `user-journey`                                                                                                              |
| FR-LEG-01, 02              | US-17                       | `src/lib/{legal,legal-version,consent}.ts`; `src/app/{terms,privacy,consent,rules}/page.tsx`; `src/components/legal/*`; `src/components/layout/site-footer.tsx`                                       | unit `legal`, `consent`; e2e `legal`, `a11y`                                                                                                                                                                            |
| FR-UI-01, 02               | US-22                       | `src/lib/theme.ts`; `src/components/layout/{theme-toggle,parallax-background}.tsx`; `src/app/globals.css`                                                                                             | e2e `theme`, `background`                                                                                                                                                                                               |
| FR-DEMO-01, 02             | UC-11 / US-21               | `src/fixtures/*`; `src/server/catalog/demo-catalog.ts`; `src/components/layout/mode-banner.tsx`                                                                                                       | e2e `smoke`, `catalog`, `betting-demo`, `leaderboard`; CI без секретов                                                                                                                                                  |

## Нефункциональные → проверка

| NFR        | Проверка                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| NFR-01…03  | `scripts/perf/measure.mjs` (локально), `scripts/perf/measure-cloud.mjs` (облако), `docs/measurements.md` |
| NFR-04     | `measure-cloud.mjs`, Event Timing — не выполнено                                                         |
| NFR-05, 06 | pgTAP `01`, `03`, `06`, `07`; интеграция `place-bet`, `settlement`                                       |
| NFR-07     | e2e `a11y` (axe, 7 страниц × 2 размера), `theme` (обе темы)                                              |
| NFR-08     | pgTAP `02_rls_access`, `10_hardening`                                                                    |
| NFR-09     | unit `routes-http`, `csp`; e2e `security`                                                                |
| NFR-10     | unit `env`, `log-redaction`; `verify.ps1` «secrets in logs»                                              |
| NFR-11     | pgTAP `08_stats` (сигнатура рейтинга), unit `routes-http` (`no-store`)                                   |
| NFR-12…14  | `/admin`, `job_runs`, `docs/runbook.md`                                                                  |
| NFR-15, 16 | GitHub Actions на каждый push; `scripts/verify.ps1`                                                      |
| NFR-17, 18 | e2e (Chromium desktop, Pixel 5 360 px)                                                                   |

## Правила, проверяемые прямым вызовом БД

Правила денег и прав (BRL-02…15, 17…27) проверяются pgTAP-тестами вызовом функций от ролей `anon`,
`authenticated` и чужого пользователя, а не только через интерфейс. Поэтому они держатся и при прямом обращении к
API Supabase с токеном пользователя.
