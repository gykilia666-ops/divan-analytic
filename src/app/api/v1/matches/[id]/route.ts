import type { NextRequest } from "next/server";
import { getMatch } from "@/server/catalog";
import { jsonError, jsonPublic } from "@/server/http/response";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await context.params;
  try {
    const match = await getMatch(id);
    if (!match) return jsonError(404, "NOT_FOUND", "Матч не найден", requestId);
    return jsonPublic(match, { lastSyncedAt: match.lastSeenAt }, requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Каталог временно недоступен", requestId);
  }
}
