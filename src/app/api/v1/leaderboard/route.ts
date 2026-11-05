import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonPublic } from "@/server/http/response";
import { getLeaderboard, LEADERBOARD_TTL_SECONDS } from "@/server/stats";

export const dynamic = "force-dynamic";

/** Публичный рейтинг (CLAUDE.md §6.10, §14.3): только безопасный DTO, общий кеш 60 секунд. */
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const board = await getLeaderboard(createClient);
    return jsonPublic(
      { entries: board.entries, minSettled: board.minSettled },
      { source: board.source, generatedAt: board.generatedAt },
      requestId,
      LEADERBOARD_TTL_SECONDS,
    );
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Рейтинг временно недоступен", requestId);
  }
}
