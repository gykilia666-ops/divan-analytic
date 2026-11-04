import { describe, expect, it } from "vitest";
import { runMatchSync, type SyncStore } from "@/server/jobs/sync-matches";
import type { UpsertPayload } from "@/server/jobs/upsert-payload";
import {
  ProviderError,
  type MatchBatch,
  type MatchDTO,
  type MatchQuery,
  type SportsProvider,
} from "@/server/providers/types";

const NOW = new Date("2026-11-04T09:00:00Z");

function dto(id: string, code: string): MatchDTO {
  return {
    providerId: id,
    competition: { providerId: code, code, name: code },
    home: { providerId: `${id}-h`, name: "Home", shortName: null },
    away: { providerId: `${id}-a`, name: "Away", shortName: null },
    kickoffAt: "2026-11-06T20:00:00.000Z",
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    resultKind: "NONE",
    providerUpdatedAt: "2026-11-04T00:00:00.000Z",
  };
}

type Behavior = MatchBatch | ProviderError;

function fakeProvider(behaviors: Record<string, Behavior>) {
  const queries: MatchQuery[] = [];
  const provider: SportsProvider = {
    id: "fake",
    async getCompetitions() {
      return [];
    },
    async getMatches(query) {
      queries.push(query);
      const b = behaviors[query.competitionCode];
      if (!b) throw new Error(`unexpected ${query.competitionCode}`);
      if (b instanceof ProviderError) throw b;
      return b;
    },
  };
  return { provider, queries };
}

function fakeStore(options: { budget?: number; upsertFails?: boolean } = {}) {
  let budget = options.budget ?? 100;
  const upserts: UpsertPayload[] = [];
  const rateLimited: (number | null)[] = [];
  const store: SyncStore = {
    async tryAcquire() {
      if (budget <= 0) return { allowed: false, retryAt: "2026-11-04T09:01:00.000Z" };
      budget -= 1;
      return { allowed: true, retryAt: null };
    },
    async reportRateLimited(_provider, seconds) {
      rateLimited.push(seconds);
      return "2026-11-04T09:00:42.000Z";
    },
    async upsertMatches(_provider, payload) {
      if (options.upsertFails) throw new Error("db down");
      upserts.push(payload);
      return { inserted: payload.matches.length, updated: 0 };
    },
  };
  return { store, upserts, rateLimited };
}

describe("runMatchSync", () => {
  it("все соревнования загружены: один запрос на соревнование, один upsert", async () => {
    const { provider, queries } = fakeProvider({
      PL: { matches: [dto("1", "PL"), dto("2", "PL")], invalidCount: 0 },
      BL1: { matches: [dto("3", "BL1")], invalidCount: 0 },
    });
    const { store, upserts } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });

    expect(s.status).toBe("ok");
    expect([s.requests, s.fetched, s.inserted]).toEqual([2, 3, 3]);
    expect(upserts).toHaveLength(1);
    expect(queries.map((q) => [q.competitionCode, q.dateFrom, q.dateTo])).toEqual([
      ["PL", "2026-11-02", "2026-11-11"],
      ["BL1", "2026-11-02", "2026-11-11"],
    ]);
  });

  it("исчерпанный бюджет: в сеть не ходим, задание пропущено", async () => {
    const { provider, queries } = fakeProvider({});
    const { store, upserts } = fakeStore({ budget: 0 });
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });

    expect(s.status).toBe("skipped");
    expect(queries).toHaveLength(0);
    expect(upserts).toHaveLength(0);
    expect(s.nextAllowedAt).toBe("2026-11-04T09:01:00.000Z");
    expect(s.competitions.map((c) => c.outcome)).toEqual(["budget_exhausted", "not_attempted"]);
  });

  it("бюджет закончился посередине: загруженное сохраняется", async () => {
    const { provider } = fakeProvider({ PL: { matches: [dto("1", "PL")], invalidCount: 0 } });
    const { store, upserts } = fakeStore({ budget: 1 });
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1", "PD"], now: NOW });

    expect(s.status).toBe("partial");
    expect(upserts[0]?.matches).toHaveLength(1);
    expect(s.competitions.map((c) => c.outcome)).toEqual([
      "fetched",
      "budget_exhausted",
      "not_attempted",
    ]);
  });

  it("429: фиксируем next_allowed_at и прекращаем обход", async () => {
    const { provider, queries } = fakeProvider({
      PL: { matches: [dto("1", "PL")], invalidCount: 0 },
      BL1: new ProviderError("RATE_LIMITED", "429", { httpStatus: 429, retryAfterSeconds: 42 }),
    });
    const { store, rateLimited, upserts } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1", "PD"], now: NOW });

    expect(rateLimited).toEqual([42]);
    expect(queries.map((q) => q.competitionCode)).toEqual(["PL", "BL1"]);
    expect(s.nextAllowedAt).toBe("2026-11-04T09:00:42.000Z");
    expect(s.status).toBe("partial");
    expect(upserts[0]?.matches).toHaveLength(1);
  });

  it("429 на первом же запросе — пропуск, без записи в БД", async () => {
    const { provider } = fakeProvider({
      PL: new ProviderError("RATE_LIMITED", "429", { httpStatus: 429, retryAfterSeconds: null }),
    });
    const { store, upserts, rateLimited } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });
    expect(s.status).toBe("skipped");
    expect(rateLimited).toEqual([null]);
    expect(upserts).toHaveLength(0);
  });

  it("таймаут одного соревнования не мешает остальным", async () => {
    const { provider } = fakeProvider({
      PL: new ProviderError("TIMEOUT", "timeout"),
      BL1: { matches: [dto("3", "BL1")], invalidCount: 0 },
    });
    const { store, upserts } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });

    expect(s.status).toBe("partial");
    expect(s.competitions[0]).toEqual({
      competition: "PL",
      outcome: "error",
      errorKind: "TIMEOUT",
    });
    expect(upserts[0]?.matches.map((m) => m.provider_id)).toEqual(["3"]);
  });

  it("401: ошибка настройки, обход прекращается, без повторов", async () => {
    const { provider, queries } = fakeProvider({
      PL: new ProviderError("UNAUTHORIZED", "401", { httpStatus: 401 }),
    });
    const { store } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });

    expect(s.status).toBe("failed");
    expect(s.configError).toBe(true);
    expect(queries).toHaveLength(1);
  });

  it("частично некорректный ответ — partial с учетом отброшенных", async () => {
    const { provider } = fakeProvider({ PL: { matches: [dto("1", "PL")], invalidCount: 2 } });
    const { store } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL"], now: NOW });
    expect([s.status, s.invalid]).toEqual(["partial", 2]);
  });

  it("все запросы упали — failed, БД не трогается", async () => {
    const { provider } = fakeProvider({
      PL: new ProviderError("NETWORK", "net"),
      BL1: new ProviderError("HTTP", "502", { httpStatus: 502 }),
    });
    const { store, upserts } = fakeStore();
    const s = await runMatchSync({ provider, store, competitions: ["PL", "BL1"], now: NOW });
    expect(s.status).toBe("failed");
    expect(upserts).toHaveLength(0);
  });

  it("ошибка БД при upsert пробрасывается (данные не меняются — функция атомарна)", async () => {
    const { provider } = fakeProvider({ PL: { matches: [dto("1", "PL")], invalidCount: 0 } });
    const { store } = fakeStore({ upsertFails: true });
    let thrown = false;
    try {
      await runMatchSync({ provider, store, competitions: ["PL"], now: NOW });
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });

  it("неожиданная (не провайдерская) ошибка не маскируется", async () => {
    const provider: SportsProvider = {
      id: "fake",
      async getCompetitions() {
        return [];
      },
      async getMatches() {
        throw new TypeError("bug");
      },
    };
    const { store } = fakeStore();
    let thrown = false;
    try {
      await runMatchSync({ provider, store, competitions: ["PL"], now: NOW });
    } catch (e) {
      thrown = e instanceof TypeError;
    }
    expect(thrown).toBe(true);
  });
});
