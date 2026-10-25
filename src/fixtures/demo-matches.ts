import { addMinutes } from "@/lib/time";

/**
 * Демонстрационные данные для режима demo и тестов (CLAUDE.md §15).
 * Клубы вымышленные: не используем реальные названия и логотипы.
 * Время — не «сегодня», а фиксированный якорь; даты сдвигаются явно от него.
 *
 * Эти типы — временная форма для UI shell (этап 1). На этапе 4 их заменят
 * DTO провайдера (SportsProvider) с Zod-валидацией; сценарии останутся.
 */

export const DEMO_NOW = "2026-10-26T12:00:00.000Z";

export type FixtureScenario =
  | "UPCOMING"
  | "CLOSING_SOON"
  | "HOME_WIN"
  | "AWAY_WIN"
  | "DRAW"
  | "CANCELLED"
  | "POSTPONED"
  | "SUSPENDED"
  | "NULL_SCORE"
  | "AMBIGUOUS_RESULT"
  | "RESULT_CHANGED_AFTER_SETTLEMENT"
  | "STALE_DATA";

export type FixtureStatus = "SCHEDULED" | "FINISHED" | "CANCELLED" | "POSTPONED" | "SUSPENDED";

export interface FixtureMatch {
  id: string;
  scenario: FixtureScenario;
  competition: string;
  home: string;
  away: string;
  /** ISO-8601 в UTC. */
  kickoffAt: string;
  status: FixtureStatus;
  /** Счет основного времени; null означает «неизвестно», а не 0. */
  homeScore: number | null;
  awayScore: number | null;
  /** Время обновления у «поставщика»; null — поставщик его не сообщил. */
  providerUpdatedAt: string | null;
  note: string;
}

const COMPETITION = "Лига Дивана";

function m(
  n: number,
  scenario: FixtureScenario,
  home: string,
  away: string,
  kickoffOffsetMin: number,
  rest: Partial<FixtureMatch> & Pick<FixtureMatch, "status" | "note">,
): FixtureMatch {
  return {
    id: `demo-${String(n).padStart(3, "0")}`,
    scenario,
    competition: COMPETITION,
    home,
    away,
    kickoffAt: addMinutes(DEMO_NOW, kickoffOffsetMin),
    homeScore: null,
    awayScore: null,
    providerUpdatedAt: addMinutes(DEMO_NOW, -5),
    ...rest,
  };
}

const DAY = 24 * 60;

export const DEMO_MATCHES: readonly FixtureMatch[] = [
  m(1, "UPCOMING", "Сибирский Север", "Енисей-Резерв", 2 * DAY, {
    status: "SCHEDULED",
    note: "Обычный предстоящий матч.",
  }),
  m(2, "CLOSING_SOON", "Красный Диван", "Пикник-Сити", 3, {
    status: "SCHEDULED",
    note: "До старта 3 минуты: приём прогнозов должен быть закрыт (этап 5).",
  }),
  m(3, "HOME_WIN", "Вечерний Обзор", "Гости без плана", -2 * DAY, {
    status: "FINISHED",
    homeScore: 2,
    awayScore: 0,
    note: "Победа хозяев.",
  }),
  m(4, "AWAY_WIN", "Тактика на салфетке", "Эксперты по ТВ", -2 * DAY, {
    status: "FINISHED",
    homeScore: 0,
    awayScore: 1,
    note: "Победа гостей.",
  }),
  m(5, "DRAW", "Нейтральный Угол", "Центр Круга", -3 * DAY, {
    status: "FINISHED",
    homeScore: 1,
    awayScore: 1,
    note: "Ничья.",
  }),
  m(6, "CANCELLED", "Дождевой Клуб", "Туман-Юнайтед", -1 * DAY, {
    status: "CANCELLED",
    note: "Отмена: ставки должны вернуться (VOID).",
  }),
  m(7, "POSTPONED", "Отложенный Спорт", "Перенос-Динамо", 1 * DAY, {
    status: "POSTPONED",
    note: "Перенос: рынок приостанавливается.",
  }),
  m(8, "SUSPENDED", "Прерванный Атлетик", "Свисток-Рейнджерс", -60, {
    status: "SUSPENDED",
    note: "Прерывание: ждём однозначный итог; через 48 ч — возврат.",
  }),
  m(9, "NULL_SCORE", "Тишина-Сити", "Пустой Табло", -3 * 60, {
    status: "FINISHED",
    homeScore: null,
    awayScore: null,
    note: "Матч завершён, но счета нет: не рассчитывать, null ≠ 0.",
  }),
  m(10, "AMBIGUOUS_RESULT", "Двойной Смысл", "Кубок и Овертайм", -4 * 60, {
    status: "FINISHED",
    homeScore: 2,
    awayScore: 2,
    note: "Итог основного времени неоднозначен: без догадок, на ручную проверку.",
  }),
  m(11, "RESULT_CHANGED_AFTER_SETTLEMENT", "Поправка-Роверс", "Арбитр-Спартак", -5 * DAY, {
    status: "FINISHED",
    homeScore: 1,
    awayScore: 0,
    note: "Поставщик изменил итог после расчёта: конфликт и аудит, без тихой перезаписи.",
  }),
  m(12, "STALE_DATA", "Заброшенный Стадион", "Давние Данные", 3 * 60, {
    status: "SCHEDULED",
    providerUpdatedAt: addMinutes(DEMO_NOW, -61),
    note: "Данные старше 60 минут: приём новых прогнозов запрещён.",
  }),
];

/** Сбои поставщика для тестов адаптера (этап 4). */
export type ProviderFaultFixture =
  | { kind: "RATE_LIMITED"; httpStatus: 429; retryAfterSeconds: number | null }
  | { kind: "TIMEOUT"; afterMs: number }
  | { kind: "PARTIAL_INVALID_RESPONSE"; validMatchIds: string[]; invalidItemCount: number };

export const PROVIDER_FAULTS: readonly ProviderFaultFixture[] = [
  { kind: "RATE_LIMITED", httpStatus: 429, retryAfterSeconds: 42 },
  { kind: "TIMEOUT", afterMs: 10_000 },
  { kind: "PARTIAL_INVALID_RESPONSE", validMatchIds: ["demo-001", "demo-003"], invalidItemCount: 2 },
];
