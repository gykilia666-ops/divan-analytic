/** Окно синхронизации и проверка диапазона дат (UTC, формат YYYY-MM-DD). */

const DAY_MS = 86_400_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Матчи за 2 дня назад (досчитать результаты) и на неделю вперед. */
export const SYNC_WINDOW = { pastDays: 2, futureDays: 7 } as const;

/** Длина диапазона, подтвержденная запросом к football-data 2026-11-04 (ADR-010). */
export const PROVIDER_MAX_RANGE_DAYS = 10;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function computeSyncWindow(
  now: Date,
  pastDays: number = SYNC_WINDOW.pastDays,
  futureDays: number = SYNC_WINDOW.futureDays,
): { dateFrom: string; dateTo: string } {
  if (Number.isNaN(now.getTime())) throw new Error("computeSyncWindow: некорректная дата");
  return {
    dateFrom: ymd(new Date(now.getTime() - pastDays * DAY_MS)),
    dateTo: ymd(new Date(now.getTime() + futureDays * DAY_MS)),
  };
}

/** Длина диапазона в днях или null, если даты некорректны (в том числе 2026-02-30). */
export function rangeDays(dateFrom: string, dateTo: string): number | null {
  if (!YMD.test(dateFrom) || !YMD.test(dateTo)) return null;
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const to = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (ymd(from) !== dateFrom || ymd(to) !== dateTo) return null;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}
