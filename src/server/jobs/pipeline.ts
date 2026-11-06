import { randomUUID } from "node:crypto";
import type { SportsProvider } from "../providers/types";
import { maintainMarkets, type MarketStore, type MarketSummary } from "./markets";
import { runMatchSync, type SyncStore, type SyncSummary } from "./sync-matches";

export const SYNC_JOB = "sync";
/** Аренда заметно длиннее предела выполнения функции (maxDuration 60 с) и таймаутов HTTP. */
export const LEASE_SECONDS = 120;
export const SETTLEMENT_BATCH = 50;

export interface JobStore {
  acquireLease(job: string, owner: string, seconds: number): Promise<number | null>;
  releaseLease(job: string, owner: string, generation: number): Promise<boolean>;
  startRun(job: string, generation: number): Promise<string>;
  finishRun(
    runId: string,
    status: JobStatus,
    summary: unknown,
    errorCode: string | null,
  ): Promise<void>;
  confirmResults(
    provider: string,
  ): Promise<{ observed: number; confirmed: number; conflicts: number }>;
  settle(
    job: string,
    owner: string,
    generation: number,
    limit: number,
  ): Promise<{ resolved: number; void: number; skipped: number; failed: number }>;
  cleanup(): Promise<Record<string, number>>;
}

export type JobStatus = "OK" | "PARTIAL" | "SKIPPED" | "FAILED";

export interface StepError {
  step: string;
  message: string;
}

export interface JobSummary {
  status: JobStatus;
  reason?: "LEASE_HELD";
  generation: number | null;
  sync: SyncSummary | null;
  markets: MarketSummary | null;
  results: { observed: number; confirmed: number; conflicts: number } | null;
  settlement: { resolved: number; void: number; skipped: number; failed: number } | null;
  cleanup: Record<string, number> | null;
  errors: StepError[];
}

export class LeaseLostError extends Error {
  constructor() {
    super("LEASE_LOST");
    this.name = "LeaseLostError";
  }
}

function errorName(error: unknown): string {
  if (error instanceof LeaseLostError) return "LEASE_LOST";
  return error instanceof Error ? error.message.slice(0, 120) : "unknown";
}

/**
 * Одно задание синхронизации и расчета (docs/requirements.md §10.3). Шаги независимы: недоступный поставщик не
 * мешает локальной работе (закрытие рынков по времени, подтверждение и расчет уже полученных итогов).
 * Потеря аренды останавливает задание: устаревший исполнитель не пишет (fencing проверяет БД).
 */
export async function runSyncJob(options: {
  jobs: JobStore;
  store: SyncStore & MarketStore;
  provider: SportsProvider;
  competitions: readonly string[];
  now: Date;
  owner?: string;
}): Promise<JobSummary> {
  const { jobs, store, provider } = options;
  const owner = options.owner ?? randomUUID();
  const summary: JobSummary = {
    status: "OK",
    generation: null,
    sync: null,
    markets: null,
    results: null,
    settlement: null,
    cleanup: null,
    errors: [],
  };

  const generation = await jobs.acquireLease(SYNC_JOB, owner, LEASE_SECONDS);
  if (generation === null) {
    return { ...summary, status: "SKIPPED", reason: "LEASE_HELD" };
  }
  summary.generation = generation;
  const runId = await jobs.startRun(SYNC_JOB, generation);

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (error) {
      summary.errors.push({ step: name, message: errorName(error) });
      if (error instanceof LeaseLostError) throw error;
      return null;
    }
  };

  try {
    summary.sync = await step("sync", () =>
      runMatchSync({ provider, store, competitions: options.competitions, now: options.now }),
    );
    summary.markets = await step("markets", () =>
      maintainMarkets({ store, provider: provider.id }),
    );
    summary.results = await step("results", () => jobs.confirmResults(provider.id));
    summary.settlement = await step("settlement", () =>
      jobs.settle(SYNC_JOB, owner, generation, SETTLEMENT_BATCH),
    );
    summary.cleanup = await step("cleanup", () => jobs.cleanup());

    const syncDegraded = summary.sync !== null && summary.sync.status !== "ok";
    summary.status =
      summary.errors.length === 5
        ? "FAILED"
        : summary.errors.length > 0 || syncDegraded
          ? "PARTIAL"
          : "OK";
  } catch {
    summary.status = "FAILED";
  } finally {
    await jobs
      .finishRun(runId, summary.status, summary, summary.errors[0]?.message ?? null)
      .catch(() => undefined);
    await jobs.releaseLease(SYNC_JOB, owner, generation).catch(() => undefined);
  }
  return summary;
}
