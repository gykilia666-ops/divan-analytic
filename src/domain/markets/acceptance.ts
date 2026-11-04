/**
 * Правило приема прогнозов (CLAUDE.md §6.6, §10.7) для отображения. Окончательное решение
 * принимает PostgreSQL в place_bet (этап 6) по тем же правилам и своим часам.
 * Время закрывает прием независимо от того, успела ли синхронизация закрыть рынок.
 */

export const CUTOFF_MINUTES = 5;
export const STALE_MINUTES = 60;

export type MarketStatus = "OPEN" | "SUSPENDED" | "CLOSED" | "RESOLVED" | "VOID";
export type MatchStatus =
  "SCHEDULED" | "LIVE" | "FINISHED" | "CANCELLED" | "POSTPONED" | "SUSPENDED";

export type AcceptanceReason =
  "OPEN" | "NO_MARKET" | "MARKET_NOT_OPEN" | "MATCH_NOT_SCHEDULED" | "CUTOFF" | "STALE";

export interface Acceptance {
  accepting: boolean;
  reason: AcceptanceReason;
  /** Момент закрытия приема (kickoff − 5 минут), ISO UTC. */
  closesAt: string;
}

export interface AcceptanceInput {
  marketStatus: MarketStatus | null;
  matchStatus: MatchStatus;
  kickoffAt: string;
  lastSeenAt: string | null;
  now: string;
}

const MINUTE = 60_000;

export function isStale(lastSeenAt: string | null, now: string): boolean {
  if (!lastSeenAt) return true;
  return Date.parse(now) - Date.parse(lastSeenAt) > STALE_MINUTES * MINUTE;
}

export function acceptanceState(input: AcceptanceInput): Acceptance {
  const kickoff = Date.parse(input.kickoffAt);
  const now = Date.parse(input.now);
  if (Number.isNaN(kickoff) || Number.isNaN(now)) {
    throw new Error("acceptanceState: некорректное время");
  }
  const closesAtMs = kickoff - CUTOFF_MINUTES * MINUTE;
  const closesAt = new Date(closesAtMs).toISOString();
  const result = (reason: AcceptanceReason): Acceptance => ({
    accepting: reason === "OPEN",
    reason,
    closesAt,
  });

  if (input.marketStatus === null) return result("NO_MARKET");
  if (input.marketStatus !== "OPEN") return result("MARKET_NOT_OPEN");
  if (input.matchStatus !== "SCHEDULED") return result("MATCH_NOT_SCHEDULED");
  // До старта должно оставаться строго больше 5 минут.
  if (now >= closesAtMs) return result("CUTOFF");
  if (isStale(input.lastSeenAt, input.now)) return result("STALE");
  return result("OPEN");
}
