/**
 * Контракт поставщика спортивных данных (CLAUDE.md §10.1). Доменные статусы не копируют
 * внешние строки: каждый адаптер маппит их явно.
 */

export type DomainMatchStatus =
  "SCHEDULED" | "LIVE" | "FINISHED" | "CANCELLED" | "POSTPONED" | "SUSPENDED";

/** NONE — итога нет; REGULAR — однозначный итог основного времени; AMBIGUOUS — не рассчитывать. */
export type ResultKind = "NONE" | "REGULAR" | "AMBIGUOUS";

export interface CompetitionDTO {
  providerId: string;
  code: string;
  name: string;
}

export interface TeamDTO {
  providerId: string;
  name: string;
  shortName: string | null;
}

export interface MatchDTO {
  providerId: string;
  competition: CompetitionDTO;
  home: TeamDTO;
  away: TeamDTO;
  /** ISO-8601 UTC. */
  kickoffAt: string;
  status: DomainMatchStatus;
  /** Счет основного времени; заполняется только при resultKind = REGULAR. */
  homeScore: number | null;
  awayScore: number | null;
  resultKind: ResultKind;
  /** Время обновления у поставщика (не время загрузки). */
  providerUpdatedAt: string | null;
}

export interface MatchQuery {
  competitionCode: string;
  /** YYYY-MM-DD, UTC. */
  dateFrom: string;
  dateTo: string;
}

export interface MatchBatch {
  matches: MatchDTO[];
  /** Элементы ответа, не прошедшие проверку: отброшены, но учтены. */
  invalidCount: number;
}

export interface SportsProvider {
  readonly id: string;
  getCompetitions(): Promise<CompetitionDTO[]>;
  getMatches(query: MatchQuery): Promise<MatchBatch>;
}

export type ProviderErrorKind =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "HTTP"
  | "INVALID_RESPONSE";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly httpStatus: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: { httpStatus?: number; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }

  /** Временный сбой: следующий запуск может попробовать снова. 401/403/429 таковыми не считаются. */
  get transient(): boolean {
    if (this.kind === "TIMEOUT" || this.kind === "NETWORK") return true;
    return this.kind === "HTTP" && this.httpStatus !== null && this.httpStatus >= 500;
  }
}
