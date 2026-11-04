import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { getMyBets, parseBetStatus } from "@/server/betting/history";
import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonOk } from "@/server/http/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  if (getEnv().APP_DATA_MODE !== "connected") {
    return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);
  }
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);

  const params = request.nextUrl.searchParams;
  const limitRaw = Number(params.get("limit") ?? "20");
  const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  try {
    const page = await getMyBets(await createClient(), {
      status: parseBetStatus(params.get("status")),
      cursor: params.get("cursor"),
      limit,
    });
    return jsonOk(page, requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
