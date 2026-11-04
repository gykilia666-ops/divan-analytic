import { describe, expect, it } from "vitest";
import { computeDemoOdds } from "@/domain/odds/demo-odds";
import { maintainMarkets, type MarketStore } from "@/server/jobs/markets";

function fakeStore(candidates: { matchId: string; providerId: string }[]) {
  const created: { modelVersion: string; items: { matchId: string }[] }[] = [];
  const calls: string[] = [];
  const store: MarketStore = {
    async closeMarkets() {
      calls.push("close");
      return { suspended: 1, closed: 2 };
    },
    async listMatchesNeedingMarket(provider, limit) {
      calls.push(`list:${provider}:${limit}`);
      return candidates;
    },
    async createMarkets(modelVersion, items) {
      calls.push("create");
      created.push({ modelVersion, items });
      return items.length;
    },
  };
  return { store, created, calls };
}

describe("maintainMarkets", () => {
  it("сначала закрывает по времени, затем создает недостающие рынки", async () => {
    const { store, created, calls } = fakeStore([
      { matchId: "m1", providerId: "560634" },
      { matchId: "m2", providerId: "560612" },
    ]);
    const s = await maintainMarkets({ store, provider: "football-data" });
    expect(calls).toEqual(["close", "list:football-data:200", "create"]);
    expect(s).toEqual({ suspended: 1, closed: 2, candidates: 2, created: 2, invalidOdds: 0 });
    expect(created[0]?.modelVersion).toBe("demo-v1");
    expect((created[0]?.items[0] as { odds?: unknown }).odds).toEqual(
      computeDemoOdds("football-data", "560634"),
    );
  });

  it("без кандидатов не вызывает создание", async () => {
    const { store, calls } = fakeStore([]);
    const s = await maintainMarkets({ store, provider: "fixtures" });
    expect(calls).toEqual(["close", "list:fixtures:200"]);
    expect(s.created).toBe(0);
  });

  it("некорректные коэффициенты: рынок не открывается и учитывается", async () => {
    const { store, created } = fakeStore([{ matchId: "m1", providerId: "" }]);
    const s = await maintainMarkets({ store, provider: "football-data" });
    expect([s.invalidOdds, s.created]).toEqual([1, 0]);
    expect(created).toHaveLength(0);
  });
});
