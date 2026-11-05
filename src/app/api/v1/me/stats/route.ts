import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonOk } from "@/server/http/response";
import { getMyStats } from "@/server/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  if (getEnv().APP_DATA_MODE !== "connected") {
    return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);
  }
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);
  try {
    return jsonOk(await getMyStats(await createClient()), requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
