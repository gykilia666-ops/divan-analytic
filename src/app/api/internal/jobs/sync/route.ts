import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { createSupabaseJobStore } from "@/server/db/job-store";
import { createAdminClient } from "@/server/db/supabase-admin";
import { createSupabaseSyncStore } from "@/server/db/sync-store";
import { jsonError, jsonOk } from "@/server/http/response";
import { runSyncJob } from "@/server/jobs/pipeline";
import { logEvent } from "@/server/observability/log";
import { createSportsProvider } from "@/server/providers/factory";
import { isAuthorizedCron } from "@/server/security/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Задание синхронизации и расчета (cron каждые 15 минут или ручной запуск). Под арендой: два
 * одновременных вызова не работают параллельно — второй получает SKIPPED/LEASE_HELD.
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
    const admin = createAdminClient();
    const summary = await runSyncJob({
      jobs: createSupabaseJobStore(admin),
      store: createSupabaseSyncStore(admin),
      provider,
      competitions,
      now: new Date(),
    });

    logEvent({
      event: "job.finished",
      level: summary.status === "FAILED" ? "error" : summary.status === "PARTIAL" ? "warn" : "info",
      requestId,
      jobId: "sync",
      durationMs: Date.now() - startedAt,
      providerStatus: summary.sync?.status ?? "none",
      processedCount: (summary.settlement?.resolved ?? 0) + (summary.settlement?.void ?? 0),
      jobStatus: summary.status,
      generation: summary.generation,
      errorCode: summary.errors[0]?.message,
      resultConflicts: summary.results?.conflicts ?? 0,
    });
    return jsonOk(summary, requestId);
  } catch (error) {
    logEvent({
      event: "job.crashed",
      level: "error",
      requestId,
      jobId: "sync",
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return jsonError(503, "SERVICE_UNAVAILABLE", "Задание недоступно", requestId);
  }
}
