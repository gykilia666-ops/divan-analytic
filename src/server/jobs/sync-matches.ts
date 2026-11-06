import { computeSyncWindow } from "@/lib/date-range";
import { ProviderError, type MatchDTO, type SportsProvider } from "../providers/types";
import { buildUpsertPayload, type UpsertPayload } from "./upsert-payload";

/** Внутренний бюджет запросов к поставщику (docs/requirements.md §10.5): не больше 8 в минуту. */
export const PROVIDER_REQUESTS_PER_MINUTE = 8;

/** Порт хранилища: в проде — Supabase (service role), в тестах — подделка. */
export interface SyncStore {
  tryAcquire(
    provider: string,
    limit: number,
  ): Promise<{ allowed: boolean; retryAt: string | null }>;
  reportRateLimited(provider: string, retryAfterSeconds: number | null): Promise<string>;
  upsertMatches(
    provider: string,
    payload: UpsertPayload,
  ): Promise<{ inserted: number; updated: number }>;
}

export type SyncStatus = "ok" | "partial" | "skipped" | "failed";

export interface CompetitionOutcome {
  competition: string;
  outcome: "fetched" | "budget_exhausted" | "rate_limited" | "error" | "not_attempted";
  errorKind?: string;
  fetched?: number;
  invalid?: number;
}

export interface SyncSummary {
  status: SyncStatus;
  provider: string;
  window: { dateFrom: string; dateTo: string };
  requests: number;
  fetched: number;
  invalid: number;
  inserted: number;
  updated: number;
  /** Когда можно снова обращаться к поставщику, если он ограничил доступ. */
  nextAllowedAt: string | null;
  /** Ошибка настройки (например, 401): повтор без вмешательства бесполезен. */
  configError: boolean;
  competitions: CompetitionOutcome[];
}

export interface SyncOptions {
  provider: SportsProvider;
  store: SyncStore;
  competitions: readonly string[];
  now: Date;
  requestsPerMinute?: number;
}

/**
 * Одна синхронизация матчей (шаги 4–7 pipeline §10.3). Без lease и cron — они появятся на этапе 7.
 * Принципы: один агрегированный запрос на соревнование; общий лимитер в БД; 429 останавливает
 * обход и сохраняет next_allowed_at; 401/403 — ошибка настройки; временный сбой одного
 * соревнования не мешает остальным; при любой ошибке уже сохраненные данные не трогаются.
 */
export async function runMatchSync(options: SyncOptions): Promise<SyncSummary> {
  const { provider, store, competitions, now } = options;
  const limit = options.requestsPerMinute ?? PROVIDER_REQUESTS_PER_MINUTE;
  const window = computeSyncWindow(now);

  const summary: SyncSummary = {
    status: "ok",
    provider: provider.id,
    window,
    requests: 0,
    fetched: 0,
    invalid: 0,
    inserted: 0,
    updated: 0,
    nextAllowedAt: null,
    configError: false,
    competitions: [],
  };

  const collected: MatchDTO[] = [];
  let stop = false;

  for (const code of competitions) {
    if (stop) {
      summary.competitions.push({ competition: code, outcome: "not_attempted" });
      continue;
    }

    const slot = await store.tryAcquire(provider.id, limit);
    if (!slot.allowed) {
      summary.nextAllowedAt = slot.retryAt;
      summary.competitions.push({ competition: code, outcome: "budget_exhausted" });
      stop = true;
      continue;
    }

    summary.requests += 1;
    try {
      const batch = await provider.getMatches({ competitionCode: code, ...window });
      collected.push(...batch.matches);
      summary.fetched += batch.matches.length;
      summary.invalid += batch.invalidCount;
      summary.competitions.push({
        competition: code,
        outcome: "fetched",
        fetched: batch.matches.length,
        invalid: batch.invalidCount,
      });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;

      if (error.kind === "RATE_LIMITED") {
        summary.nextAllowedAt = await store.reportRateLimited(provider.id, error.retryAfterSeconds);
        summary.competitions.push({ competition: code, outcome: "rate_limited" });
        stop = true;
        continue;
      }
      summary.competitions.push({ competition: code, outcome: "error", errorKind: error.kind });
      if (error.kind === "UNAUTHORIZED" || error.kind === "FORBIDDEN") {
        summary.configError = true;
        stop = true;
      }
    }
  }

  if (collected.length > 0) {
    const result = await store.upsertMatches(provider.id, buildUpsertPayload(collected));
    summary.inserted = result.inserted;
    summary.updated = result.updated;
  }

  const fetchedCount = summary.competitions.filter((c) => c.outcome === "fetched").length;
  const anyProblem = summary.competitions.some((c) => c.outcome !== "fetched");
  if (fetchedCount === 0) {
    const onlyThrottled = summary.competitions.every(
      (c) =>
        c.outcome === "budget_exhausted" ||
        c.outcome === "rate_limited" ||
        c.outcome === "not_attempted",
    );
    summary.status = competitions.length === 0 || onlyThrottled ? "skipped" : "failed";
  } else {
    summary.status = anyProblem || summary.invalid > 0 ? "partial" : "ok";
  }
  return summary;
}
