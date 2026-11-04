import { describe, expect, it } from "vitest";
import { LeaseLostError, runSyncJob, type JobStore } from "@/server/jobs/pipeline";
import type { MarketStore } from "@/server/jobs/markets";
import type { SyncStore } from "@/server/jobs/sync-matches";
import { ProviderError, type SportsProvider } from "@/server/providers/types";

const NOW = new Date("2026-11-05T09:00:00Z");

function fakeJobs(options: { leaseFree?: boolean; settleFails?: "lease" | "error" } = {}) {
  const calls: string[] = [];
  const finished: { status: string }[] = [];
  const jobs: JobStore = {
    async acquireLease() {
      calls.push("acquire");
      return options.leaseFree === false ? null : 7;
    },
    async releaseLease(_job, _owner, generation) {
      calls.push(`release:${generation}`);
      return true;
    },
    async startRun() {
      calls.push("start");
      return "run-1";
    },
    async finishRun(_id, status) {
      calls.push(`finish:${status}`);
      finished.push({ status });
    },
    async confirmResults() {
      calls.push("confirm");
      return { observed: 1, confirmed: 1, conflicts: 0 };
    },
    async settle(_job, _owner, generation) {
      calls.push(`settle:${generation}`);
      if (options.settleFails === "lease") throw new LeaseLostError();
      if (options.settleFails === "error") throw new Error("boom");
      return { resolved: 1, void: 0, skipped: 0, failed: 0 };
    },
    async cleanup() {
      calls.push("cleanup");
      return { rateLimitBuckets: 0, jobRuns: 0 };
    },
  };
  return { jobs, calls, finished };
}

function fakeStore(): SyncStore & MarketStore {
  return {
    async tryAcquire() {
      return { allowed: true, retryAt: null };
    },
    async reportRateLimited() {
      return "2026-11-05T09:01:00Z";
    },
    async upsertMatches() {
      return { inserted: 0, updated: 0 };
    },
    async closeMarkets() {
      return { suspended: 0, closed: 0 };
    },
    async listMatchesNeedingMarket() {
      return [];
    },
    async createMarkets() {
      return 0;
    },
  };
}

function provider(fails = false): SportsProvider {
  return {
    id: "fake",
    async getCompetitions() {
      return [];
    },
    async getMatches() {
      if (fails) throw new ProviderError("TIMEOUT", "timeout");
      return { matches: [], invalidCount: 0 };
    },
  };
}

describe("runSyncJob", () => {
  it("все шаги по порядку под арендой; аренда освобождается", async () => {
    const { jobs, calls } = fakeJobs();
    const s = await runSyncJob({
      jobs,
      store: fakeStore(),
      provider: provider(),
      competitions: ["PL"],
      now: NOW,
    });
    expect(s.status).toBe("OK");
    expect(s.generation).toBe(7);
    expect(calls).toEqual([
      "acquire",
      "start",
      "confirm",
      "settle:7",
      "cleanup",
      "finish:OK",
      "release:7",
    ]);
  });

  it("аренда занята: ничего не делается, поставщик не вызывается", async () => {
    const { jobs, calls } = fakeJobs({ leaseFree: false });
    let providerCalled = false;
    const p = provider();
    const spy: SportsProvider = {
      ...p,
      async getMatches(q) {
        providerCalled = true;
        return p.getMatches(q);
      },
    };
    const s = await runSyncJob({
      jobs,
      store: fakeStore(),
      provider: spy,
      competitions: ["PL"],
      now: NOW,
    });
    expect([s.status, s.reason]).toEqual(["SKIPPED", "LEASE_HELD"]);
    expect(calls).toEqual(["acquire"]);
    expect(providerCalled).toBe(false);
  });

  it("поставщик недоступен — локальная работа (рынки, подтверждение, расчет) все равно выполняется", async () => {
    const { jobs, calls } = fakeJobs();
    const s = await runSyncJob({
      jobs,
      store: fakeStore(),
      provider: provider(true),
      competitions: ["PL"],
      now: NOW,
    });
    expect(s.status).toBe("PARTIAL");
    expect(s.sync?.status).toBe("failed");
    expect(calls).toContain("settle:7");
    expect(s.settlement?.resolved).toBe(1);
  });

  it("потеря аренды останавливает задание, запуск помечается FAILED, аренда освобождается", async () => {
    const { jobs, calls } = fakeJobs({ settleFails: "lease" });
    const s = await runSyncJob({
      jobs,
      store: fakeStore(),
      provider: provider(),
      competitions: ["PL"],
      now: NOW,
    });
    expect(s.status).toBe("FAILED");
    expect(s.errors).toEqual([{ step: "settlement", message: "LEASE_LOST" }]);
    expect(calls).not.toContain("cleanup");
    expect(calls.slice(-2)).toEqual(["finish:FAILED", "release:7"]);
  });

  it("сбой одного шага не останавливает остальные", async () => {
    const { jobs, calls } = fakeJobs({ settleFails: "error" });
    const s = await runSyncJob({
      jobs,
      store: fakeStore(),
      provider: provider(),
      competitions: ["PL"],
      now: NOW,
    });
    expect(s.status).toBe("PARTIAL");
    expect(calls).toContain("cleanup");
    expect(s.errors.map((e) => e.step)).toEqual(["settlement"]);
  });
});
