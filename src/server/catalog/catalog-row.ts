import { z } from "zod";
import { acceptanceState, isStale } from "@/domain/markets/acceptance";
import type { CatalogMatch } from "./types";

const matchStatus = z.enum([
  "SCHEDULED",
  "LIVE",
  "FINISHED",
  "CANCELLED",
  "POSTPONED",
  "SUSPENDED",
]);
const marketStatus = z.enum(["OPEN", "SUSPENDED", "CLOSED", "RESOLVED", "VOID"]);

/** Строка витрины public.match_catalog. */
export const catalogRowSchema = z.object({
  id: z.string(),
  competition_code: z.string(),
  competition_name: z.string(),
  home_name: z.string(),
  away_name: z.string(),
  kickoff_at: z.string(),
  status: matchStatus,
  home_score: z.number().int().nullable(),
  away_score: z.number().int().nullable(),
  result_kind: z.enum(["NONE", "REGULAR", "AMBIGUOUS"]),
  last_seen_at: z.string().nullable(),
  market_id: z.string().nullable(),
  market_status: marketStatus.nullable(),
  quote_version: z.number().int().nullable(),
  model_version: z.string().nullable(),
  home_odds_milli: z.number().int().nullable(),
  draw_odds_milli: z.number().int().nullable(),
  away_odds_milli: z.number().int().nullable(),
  db_now: z.string(),
});
export type CatalogRow = z.infer<typeof catalogRowSchema>;

export const iso = (value: string) => new Date(value).toISOString();

export function rowToCatalog(row: CatalogRow): CatalogMatch {
  const now = iso(row.db_now);
  const lastSeenAt = row.last_seen_at ? iso(row.last_seen_at) : null;
  const hasMarket =
    row.market_id !== null &&
    row.market_status !== null &&
    row.quote_version !== null &&
    row.model_version !== null &&
    row.home_odds_milli !== null &&
    row.draw_odds_milli !== null &&
    row.away_odds_milli !== null;

  return {
    id: row.id,
    competition: { code: row.competition_code, name: row.competition_name },
    home: row.home_name,
    away: row.away_name,
    kickoffAt: iso(row.kickoff_at),
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    resultKind: row.result_kind,
    lastSeenAt,
    stale: isStale(lastSeenAt, now),
    market: hasMarket
      ? {
          id: row.market_id as string,
          status: row.market_status as NonNullable<CatalogRow["market_status"]>,
          quoteVersion: row.quote_version as number,
          modelVersion: row.model_version as string,
          odds: {
            home: row.home_odds_milli as number,
            draw: row.draw_odds_milli as number,
            away: row.away_odds_milli as number,
          },
        }
      : null,
    acceptance: acceptanceState({
      marketStatus: hasMarket ? row.market_status : null,
      matchStatus: row.status,
      kickoffAt: row.kickoff_at,
      lastSeenAt,
      now,
    }),
    note: null,
  };
}
