import type { NextRequest } from "next/server";
import { isAllowedOrigin } from "@/lib/origin";
import { AdminForbiddenError, requestAdminSync } from "@/server/admin";
import { guardAdmin } from "@/server/admin/guard";
import { jsonError, jsonOk } from "@/server/http/response";
import { executeSyncJob } from "@/server/jobs/execute";
import { logEvent } from "@/server/observability/log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ручной запуск синхронизации администратором: не чаще раза в 5 минут (§13.5), под общей арендой. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const guard = await guardAdmin(requestId);
  if (!guard.ok) return guard.response;
  if (!isAllowedOrigin(request.headers.get("origin"), guard.env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }
  try {
    const permit = await requestAdminSync(guard.supabase);
    if (!permit.ok) {
      return jsonError(429, "RATE_LIMITED", "Ручной запуск — не чаще раза в 5 минут", requestId);
    }
    logEvent({ event: "admin.sync_requested", requestId });
    return jsonOk(await executeSyncJob(guard.env, requestId, "admin"), requestId);
  } catch (error) {
    if (error instanceof AdminForbiddenError) {
      return jsonError(403, "FORBIDDEN", "Недостаточно прав", requestId);
    }
    return jsonError(503, "SERVICE_UNAVAILABLE", "Задание недоступно", requestId);
  }
}
