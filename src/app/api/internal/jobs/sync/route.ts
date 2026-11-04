import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { createSupabaseSyncStore } from "@/server/db/sync-store";
import { createAdminClient } from "@/server/db/supabase-admin";
import { jsonError, jsonOk } from "@/server/http/response";
import { runMatchSync } from "@/server/jobs/sync-matches";
import { logEvent } from "@/server/observability/log";
import { createSportsProvider } from "@/server/providers/factory";
import { isAuthorizedCron } from "@/server/security/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ручной/cron-запуск синхронизации матчей. Lease, job_runs и расписание — этап 7; до тех пор
 * параллельные вызовы безопасны за счет общего лимитера и идемпотентного upsert.
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();

  if (env.APP_DATA_MODE !== "connected") {
    return jsonError(404, "NOT_FOUND", "Не найдено", requestId);
  }
  if (!isAuthorizedCron(request.headers.get("authorization"), env.CRON_SECRET)) {
    return jsonError(401, "UNAUTHENTICATED", "Требуется аутентификация", requestId);
  }

  const startedAt = Date.now();
  try {
    const { provider, competitions } = createSportsProvider(env);
    const store = createSupabaseSyncStore(createAdminClient());
    const summary = await runMatchSync({ provider, store, competitions, now: new Date() });

    logEvent({
      event: "sync.finished",
      level: summary.status === "failed" || summary.configError ? "error" : "info",
      requestId,
      durationMs: Date.now() - startedAt,
      providerStatus: summary.status,
      processedCount: summary.inserted + summary.updated,
      requests: summary.requests,
      invalid: summary.invalid,
      configError: summary.configError,
    });
    return jsonOk(summary, requestId);
  } catch (error) {
    logEvent({
      event: "sync.crashed",
      level: "error",
      requestId,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return jsonError(503, "SERVICE_UNAVAILABLE", "Синхронизация недоступна", requestId);
  }
}
