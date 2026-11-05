/**
 * Формулы статистики и рейтинга (CLAUDE.md §6.9, §6.10). Чистые функции: одинаковы для БД и демо.
 * - В основной расчет входят только WON и LOST; VOID и PENDING не участвуют.
 * - profit = выплаты по WON/LOST − ставки по WON/LOST; ROI = profit / stakes × 100%;
 *   win rate = WON / (WON + LOST) × 100%; нулевой знаменатель → null («—»).
 */

export const LEADERBOARD_MIN_SETTLED = 5;

export type SettledStatus = "PENDING" | "WON" | "LOST" | "VOID";

export interface StatsTotals {
  won: number;
  lost: number;
  void: number;
  pending: number;
  /** Сумма ставок по WON/LOST. */
  stakes: number;
  /** Сумма выплат по WON/LOST (LOST = 0). */
  payouts: number;
}

export interface StatsSummary extends StatsTotals {
  settled: number;
  profit: number;
  winRate: number | null;
  roi: number | null;
}

export interface StatsBet {
  status: SettledStatus;
  stake: number;
  actualPayout: number | null;
}

export function emptyTotals(): StatsTotals {
  return { won: 0, lost: 0, void: 0, pending: 0, stakes: 0, payouts: 0 };
}

export function aggregateBets(bets: readonly StatsBet[]): StatsTotals {
  const t = emptyTotals();
  for (const bet of bets) {
    switch (bet.status) {
      case "WON":
      case "LOST":
        if (bet.status === "WON") t.won += 1;
        else t.lost += 1;
        t.stakes += bet.stake;
        t.payouts += bet.actualPayout ?? 0;
        break;
      case "VOID":
        t.void += 1;
        break;
      case "PENDING":
        t.pending += 1;
        break;
    }
  }
  return t;
}

export function summarize(t: StatsTotals): StatsSummary {
  const settled = t.won + t.lost;
  const profit = t.payouts - t.stakes;
  return {
    ...t,
    settled,
    profit,
    winRate: settled === 0 ? null : (t.won / settled) * 100,
    roi: t.stakes === 0 ? null : (profit / t.stakes) * 100,
  };
}

/** Сколько рассчитанных прогнозов не хватает до рейтинга (0 — допущен). */
export function missingForLeaderboard(settled: number): number {
  return Math.max(LEADERBOARD_MIN_SETTLED - settled, 0);
}

const percentFormat = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const integerFormat = new Intl.NumberFormat("ru-RU");

/** «—» для пустого знаменателя; иначе одна цифра после запятой. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  // −0,0 выглядит странно: округленный ноль без знака.
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  const text = percentFormat.format(Math.abs(normalized));
  return `${normalized < 0 ? "−" : ""}${text} %`;
}

/** Число со знаком: «+200», «−300», «0». */
export function formatSigned(value: number): string {
  if (value === 0) return "0";
  return `${value > 0 ? "+" : "−"}${integerFormat.format(Math.abs(value))}`;
}

export interface LeaderboardEntry {
  place: number;
  displayName: string;
  avatarUrl: string | null;
  settled: number;
  won: number;
  stakes: number;
  netProfit: number;
  winRate: number | null;
  roi: number | null;
}

export interface RankablePlayer {
  /** Технический идентификатор только для стабильной сортировки, наружу не выдается. */
  id: string;
  displayName: string;
  avatarUrl: string | null;
  disabled?: boolean;
  bets: readonly StatsBet[];
}

/** Та же логика, что в SQL leaderboard_ranked: допуск, исключение отключенных, порядок. */
export function rankPlayers(players: readonly RankablePlayer[]): LeaderboardEntry[] {
  const rows = players
    .filter((p) => !p.disabled)
    .map((p) => ({ id: p.id, player: p, s: summarize(aggregateBets(p.bets)) }))
    .filter((r) => r.s.settled >= LEADERBOARD_MIN_SETTLED);
  rows.sort(
    (a, b) =>
      b.s.profit - a.s.profit ||
      b.s.settled - a.s.settled ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return rows.map((r, i) => ({
    place: i + 1,
    displayName: r.player.displayName,
    avatarUrl: r.player.avatarUrl,
    settled: r.s.settled,
    won: r.s.won,
    stakes: r.s.stakes,
    netProfit: r.s.profit,
    winRate: r.s.winRate,
    roi: r.s.roi,
  }));
}

/** Строка рейтинга из агрегатов БД (формулы те же, что в summarize). */
export function entryFromAggregates(row: {
  place: number;
  displayName: string;
  avatarUrl: string | null;
  settled: number;
  won: number;
  stakes: number;
  netProfit: number;
}): LeaderboardEntry {
  return {
    ...row,
    winRate: row.settled === 0 ? null : (row.won / row.settled) * 100,
    roi: row.stakes === 0 ? null : (row.netProfit / row.stakes) * 100,
  };
}
