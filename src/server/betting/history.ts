import "server-only";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "@/server/catalog/cursor";
import { iso } from "@/server/catalog/catalog-row";
import type { ServerSupabase } from "@/server/db/supabase-server";

export const BET_STATUSES = ["PENDING", "WON", "LOST", "VOID"] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

const rowSchema = z.object({
  id: z.string(),
  outcome: z.enum(["HOME", "DRAW", "AWAY"]),
  stake: z.number().int(),
  accepted_odds_milli: z.number().int(),
  potential_payout: z.number().int(),
  actual_payout: z.number().int().nullable(),
  status: z.enum(BET_STATUSES),
  created_at: z.string(),
  settled_at: z.string().nullable(),
  match_id: z.string(),
  kickoff_at: z.string(),
  competition_name: z.string(),
  home_name: z.string(),
  away_name: z.string(),
  home_score: z.number().int().nullable(),
  away_score: z.number().int().nullable(),
});

export interface BetHistoryItem {
  id: string;
  outcome: "HOME" | "DRAW" | "AWAY";
  stake: number;
  acceptedOddsMilli: number;
  potentialPayout: number;
  actualPayout: number | null;
  status: BetStatus;
  createdAt: string;
  settledAt: string | null;
  match: {
    id: string;
    kickoffAt: string;
    competition: string;
    home: string;
    away: string;
    homeScore: number | null;
    awayScore: number | null;
  };
}

/** История прогнозов текущего пользователя (RLS: только свои), новые сверху. */
export async function getMyBets(
  supabase: ServerSupabase,
  options: { status: BetStatus | null; cursor: string | null; limit: number },
): Promise<{ items: BetHistoryItem[]; nextCursor: string | null }> {
  const cursor = decodeCursor(options.cursor);
  const { data, error } = await supabase.rpc("list_my_bets", {
    p_status: options.status,
    p_after_created: cursor?.kickoffAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: options.limit,
  });
  if (error) throw new Error(`list_my_bets failed: ${error.code ?? "unknown"}`);

  const rows = z.array(rowSchema).parse(data);
  const items = rows.slice(0, options.limit).map((r): BetHistoryItem => ({
    id: r.id,
    outcome: r.outcome,
    stake: r.stake,
    acceptedOddsMilli: r.accepted_odds_milli,
    potentialPayout: r.potential_payout,
    actualPayout: r.actual_payout,
    status: r.status,
    createdAt: iso(r.created_at),
    settledAt: r.settled_at ? iso(r.settled_at) : null,
    match: {
      id: r.match_id,
      kickoffAt: iso(r.kickoff_at),
      competition: r.competition_name,
      home: r.home_name,
      away: r.away_name,
      homeScore: r.home_score,
      awayScore: r.away_score,
    },
  }));
  const last = items[items.length - 1];
  // Курсор переиспользует формат каталога: (время, id), здесь время — created_at.
  return {
    items,
    nextCursor:
      rows.length > options.limit && last
        ? encodeCursor({ kickoffAt: last.createdAt, id: last.id })
        : null,
  };
}

export function parseBetStatus(raw: unknown): BetStatus | null {
  return typeof raw === "string" && (BET_STATUSES as readonly string[]).includes(raw)
    ? (raw as BetStatus)
    : null;
}
