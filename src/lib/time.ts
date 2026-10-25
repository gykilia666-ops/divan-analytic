/**
 * Время в приложении. Доменное время — часы PostgreSQL (этап 6); здесь только
 * абстракция часов для UI/fixtures/тестов, чтобы тесты не зависели от реальной даты.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export function fixedClock(iso: string): Clock {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) {
    throw new Error(`fixedClock: некорректная дата «${iso}»`);
  }
  return { now: () => new Date(t.getTime()) };
}

/** Зона для проверки сценариев Красноярска (UTC+7, без перехода на летнее время). */
export const KRASNOYARSK_TZ = "Asia/Krasnoyarsk";

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Формат «26 окт., 19:00 (Asia/Krasnoyarsk)». Зона всегда указывается явно.
 * Принимает только ISO-строку с указанием зоны (Z или смещение), чтобы не
 * трактовать «голую» дату в локальной зоне процесса.
 */
export function formatKickoff(iso: string, timeZone: string): string {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(iso)) {
    throw new Error(`formatKickoff: ожидается ISO-время с зоной, получено «${iso}»`);
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`formatKickoff: некорректная дата «${iso}»`);
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error(`formatKickoff: неизвестная зона «${timeZone}»`);
  }
  const text = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${text} (${timeZone})`;
}

/** Сдвиг от опорного момента в минутах — для fixtures с явным «сдвигом демонстрационных дат». */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
