import type { DomainMatchStatus, ResultKind } from "../types";

/**
 * Явный маппинг статусов football-data v4. Неизвестный статус → null (элемент отбрасывается,
 * а не угадывается). Подтверждено запросом 2026-11-04: у предстоящих матчей статус TIMED.
 */
const STATUS_MAP = new Map<string, DomainMatchStatus>([
  ["SCHEDULED", "SCHEDULED"],
  ["TIMED", "SCHEDULED"],
  ["IN_PLAY", "LIVE"],
  ["PAUSED", "LIVE"],
  ["EXTRA_TIME", "LIVE"],
  ["PENALTY_SHOOTOUT", "LIVE"],
  ["FINISHED", "FINISHED"],
  // Технический результат (присуждение): матч завершен, но итог основного времени не сыгран.
  ["AWARDED", "FINISHED"],
  ["SUSPENDED", "SUSPENDED"],
  ["POSTPONED", "POSTPONED"],
  ["CANCELLED", "CANCELLED"],
]);

export function mapStatus(raw: string): DomainMatchStatus | null {
  return STATUS_MAP.get(raw) ?? null;
}

export interface ScorePair {
  home: number | null;
  away: number | null;
}

export interface ResultInput {
  rawStatus: string;
  duration: string | null | undefined;
  fullTime: ScorePair;
  regularTime?: ScorePair | null;
}

export interface ResolvedResult {
  resultKind: ResultKind;
  homeScore: number | null;
  awayScore: number | null;
}

const NONE: ResolvedResult = { resultKind: "NONE", homeScore: null, awayScore: null };
const AMBIGUOUS: ResolvedResult = { resultKind: "AMBIGUOUS", homeScore: null, awayScore: null };

function complete(pair: ScorePair | null | undefined): pair is { home: number; away: number } {
  return pair !== null && pair !== undefined && pair.home !== null && pair.away !== null;
}

/**
 * Итог основного времени (ADR-009). fullTime при duration = REGULAR — итог основного времени;
 * при EXTRA_TIME / PENALTY_SHOOTOUT fullTime включает дополнительное время, поэтому берем только
 * regularTime. Любая неполнота — AMBIGUOUS, без догадок. Счет возвращается только для REGULAR.
 */
export function resolveResult(input: ResultInput): ResolvedResult {
  if (input.rawStatus === "AWARDED") return AMBIGUOUS;
  if (input.rawStatus !== "FINISHED") return NONE;

  if (input.duration === "REGULAR") {
    const { home, away } = input.fullTime;
    if (home === null && away === null) return NONE; // завершен, но счета еще нет
    if (!complete(input.fullTime)) return AMBIGUOUS;
    return { resultKind: "REGULAR", homeScore: home, awayScore: away };
  }

  if (complete(input.regularTime)) {
    return {
      resultKind: "REGULAR",
      homeScore: input.regularTime.home,
      awayScore: input.regularTime.away,
    };
  }
  return AMBIGUOUS;
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Нормализация времени в UTC ISO; null при некорректном значении или времени без зоны. */
export function toUtcIso(value: string): string | null {
  if (!ISO_WITH_ZONE.test(value)) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
