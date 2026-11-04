import type { Acceptance, MarketStatus, MatchStatus } from "@/domain/markets/acceptance";

// Статусы передаются текстом, а не только цветом.
export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  SCHEDULED: "Запланирован",
  LIVE: "Идёт",
  FINISHED: "Завершён",
  CANCELLED: "Отменён",
  POSTPONED: "Перенесён",
  SUSPENDED: "Прерван",
};

export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  OPEN: "открыт",
  SUSPENDED: "приостановлен",
  CLOSED: "закрыт",
  RESOLVED: "рассчитан",
  VOID: "аннулирован",
};

export const OUTCOME_LABEL = {
  home: { short: "1", long: "Победа хозяев" },
  draw: { short: "X", long: "Ничья" },
  away: { short: "2", long: "Победа гостей" },
} as const;

/** Короткое объяснение состояния приема (без времени — его выводит компонент). */
export function acceptanceText(acceptance: Acceptance): string {
  switch (acceptance.reason) {
    case "OPEN":
      return "Прием прогнозов открыт до";
    case "CUTOFF":
      return "Прием закрыт: до начала матча меньше 5 минут";
    case "STALE":
      return "Прием закрыт: данные поставщика обновлялись больше часа назад";
    case "MATCH_NOT_SCHEDULED":
      return "Прием закрыт: матч уже не в статусе «запланирован»";
    case "MARKET_NOT_OPEN":
      return "Прием закрыт";
    case "NO_MARKET":
      return "Коэффициентов для этого матча нет";
  }
}
