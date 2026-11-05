import "server-only";
import { z } from "zod";
import {
  entryFromAggregates,
  LEADERBOARD_MIN_SETTLED,
  rankPlayers,
  summarize,
  type LeaderboardEntry,
  type StatsSummary,
} from "@/domain/stats/stats";
import { DEMO_LEADERBOARD_PLAYERS } from "@/fixtures/demo-leaderboard";
import { getEnv } from "@/lib/env";
import { createTtlCache } from "@/lib/ttl-cache";
import type { ServerSupabase } from "@/server/db/supabase-server";

export const LEADERBOARD_TTL_SECONDS = 60;
export const LEADERBOARD_LIMIT = 50;

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  source: "demo" | "db";
  minSettled: number;
  generatedAt: string;
}

export interface MyStats {
  stats: StatsSummary;
  /** Место в рейтинге; null — еще не допущен. */
  place: number | null;
}

const count = z.number().int().nonnegative();
const myStatsSchema = z.object({
  won_count: count,
  lost_count: count,
  void_count: count,
  pending_count: count,
  stakes: count,
  payouts: count,
});

const leaderboardRowSchema = z.object({
  place: z.number().int().positive(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
  settled_count: count,
  won_count: count,
  stakes: count,
  net_profit: z.number().int(),
});

/** Личная статистика по RLS. Исключение — ошибка БД (страница покажет состояние ошибки). */
export async function getMyStats(supabase: ServerSupabase): Promise<MyStats> {
  const [statsRes, placeRes] = await Promise.all([
    supabase.rpc("my_stats"),
    supabase.rpc("my_leaderboard_place"),
  ]);
  if (statsRes.error) throw new Error(`my_stats failed: ${statsRes.error.code ?? "unknown"}`);
  if (placeRes.error) {
    throw new Error(`my_leaderboard_place failed: ${placeRes.error.code ?? "unknown"}`);
  }
  const row = myStatsSchema.parse(z.array(z.unknown()).parse(statsRes.data)[0]);
  const place = z
    .number()
    .int()
    .positive()
    .nullable()
    .parse(placeRes.data ?? null);
  return {
    stats: summarize({
      won: row.won_count,
      lost: row.lost_count,
      void: row.void_count,
      pending: row.pending_count,
      stakes: row.stakes,
      payouts: row.payouts,
    }),
    place,
  };
}

export function getDemoLeaderboard(now: Date = new Date()): LeaderboardData {
  return {
    entries: rankPlayers(DEMO_LEADERBOARD_PLAYERS),
    source: "demo",
    minSettled: LEADERBOARD_MIN_SETTLED,
    generatedAt: now.toISOString(),
  };
}

async function loadDbLeaderboard(supabase: ServerSupabase): Promise<LeaderboardData> {
  const { data, error } = await supabase.rpc("leaderboard", { p_limit: LEADERBOARD_LIMIT });
  if (error) throw new Error(`leaderboard failed: ${error.code ?? "unknown"}`);
  const rows = z.array(leaderboardRowSchema).parse(data);
  return {
    entries: rows.map((r) =>
      entryFromAggregates({
        place: r.place,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        settled: r.settled_count,
        won: r.won_count,
        stakes: r.stakes,
        netProfit: r.net_profit,
      }),
    ),
    source: "db",
    minSettled: LEADERBOARD_MIN_SETTLED,
    generatedAt: new Date().toISOString(),
  };
}

// Рейтинг одинаков для всех (SECURITY DEFINER, без персональных полей), поэтому его можно
// разделять между запросами разных пользователей.
const leaderboardCache = createTtlCache<LeaderboardData>(LEADERBOARD_TTL_SECONDS * 1000);

export async function getLeaderboard(
  createClient: () => Promise<ServerSupabase>,
): Promise<LeaderboardData> {
  if (getEnv().APP_DATA_MODE !== "connected") return getDemoLeaderboard();
  return leaderboardCache.get(async () => loadDbLeaderboard(await createClient()));
}
