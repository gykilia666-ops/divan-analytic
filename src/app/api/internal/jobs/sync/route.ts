import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { jsonError, jsonOk } from "@/server/http/response";
import { executeSyncJob } from "@/server/jobs/execute";
import { isAuthorizedCron } from "@/server/security/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Задание синхронизации и расчета для cron (каждые 15 минут). Bearer CRON_SECRET. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();

  if (env.APP_DATA_MODE !== "connected") {
    return jsonError(404, "NOT_FOUND", "Не найдено", requestId);
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError(401, "UNAUTHENTICATED", "Требуется аутентификация", requestId);
  }
  try {
    return jsonOk(await executeSyncJob(env, requestId, "cron"), requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Задание недоступно", requestId);
  }
}
