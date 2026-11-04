import type { Acceptance, MarketStatus, MatchStatus } from "@/domain/markets/acceptance";
import type { OddsMilli } from "@/domain/odds/demo-odds";

/** open — можно сделать прогноз (по умолчанию); upcoming — не завершенные; finished; all. */
export const CATALOG_SCOPES = ["open", "upcoming", "finished", "all"] as const;
export type CatalogScope = (typeof CATALOG_SCOPES)[number];

export interface CatalogQuery {
  competition: string | null;
  /** YYYY-MM-DD в зоне timeZone; null — без фильтра по дате. */
  date: string | null;
  timeZone: string;
  scope: CatalogScope;
  cursor: string | null;
  limit: number;
}

export interface CatalogMarket {
  id: string;
  status: MarketStatus;
  quoteVersion: number;
  modelVersion: string;
  odds: OddsMilli;
}

export interface CatalogMatch {
  id: string;
  competition: { code: string; name: string };
  home: string;
  away: string;
  kickoffAt: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  resultKind: "NONE" | "REGULAR" | "AMBIGUOUS";
  /** Когда матч последний раз приходил от поставщика (для свежести данных). */
  lastSeenAt: string | null;
  stale: boolean;
  market: CatalogMarket | null;
  acceptance: Acceptance;
  /** Пояснение сценария (только демо-режим). */
  note: string | null;
}

export interface CatalogPage {
  items: CatalogMatch[];
  nextCursor: string | null;
  competitions: { code: string; name: string }[];
  /** «Текущий момент» источника: часы PostgreSQL или фиксированное время демо. */
  now: string;
  /** Самое свежее наблюдение поставщика среди показанных матчей. */
  lastSyncedAt: string | null;
  source: "demo" | "database";
}
