import { isValidTimeZone } from "./time";

/**
 * Сутки в выбранной зоне → интервал UTC [from, to) (docs/requirements.md §6.5). Учитывает переходы на
 * летнее время: сутки могут длиться 23 или 25 часов.
 */

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Смещение зоны относительно UTC в минутах в момент instant. */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/** UTC-момент локальной полуночи даты (y, m, d) в зоне. */
function localMidnightUtc(y: number, m: number, d: number, timeZone: string): number {
  const naive = Date.UTC(y, m - 1, d);
  let guess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  // Второе приближение: смещение могло отличаться в самом моменте полуночи.
  guess = naive - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  return guess;
}

export function isValidYmd(value: string): boolean {
  const match = YMD.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value;
}

export function zonedDayToUtcRange(ymd: string, timeZone: string): { from: string; to: string } {
  if (!isValidYmd(ymd)) throw new Error("zonedDayToUtcRange: некорректная дата");
  if (!isValidTimeZone(timeZone)) throw new Error("zonedDayToUtcRange: неизвестная зона");
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    from: new Date(localMidnightUtc(y, m, d, timeZone)).toISOString(),
    to: new Date(
      localMidnightUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
    ).toISOString(),
  };
}

/** Текущая дата в зоне в формате YYYY-MM-DD. */
export function todayInZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}
