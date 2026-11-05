import "server-only";
import type { AppEnv } from "@/lib/env";
import { createSupabaseJobStore } from "@/server/db/job-store";
import { createAdminClient } from "@/server/db/supabase-admin";
import { createSupabaseSyncStore } from "@/server/db/sync-store";
import { runSyncJob, type JobSummary } from "@/server/jobs/pipeline";
import { logEvent } from "@/server/observability/log";
import { createSportsProvider } from "@/server/providers/factory";

export type JobTrigger = "cron" | "admin";

/**
 * Один запуск конвейера синхронизации и расчета под арендой. Общий для cron и ручного запуска
 * администратором: два одновременных вызова не работают параллельно (второй — SKIPPED/LEASE_HELD).
 * Исключение — только при сбое создания зависимостей; сбои шагов попадают в summary.
 */
export async function executeSyncJob(
  env: AppEnv,
  requestId: string,
  trigger: JobTrigger,
): Promise<JobSummary> {
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
      trigger,
      durationMs: Date.now() - startedAt,
      providerStatus: summary.sync?.status ?? "none",
      processedCount: (summary.settlement?.resolved ?? 0) + (summary.settlement?.void ?? 0),
      jobStatus: summary.status,
      generation: summary.generation,
      errorCode: summary.errors[0]?.message,
      resultConflicts: summary.results?.conflicts ?? 0,
    });
    return summary;
  } catch (error) {
    logEvent({
      event: "job.crashed",
      level: "error",
      requestId,
      jobId: "sync",
      trigger,
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}
