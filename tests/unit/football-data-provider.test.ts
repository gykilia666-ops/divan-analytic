import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FootballDataClient } from "@/server/providers/football-data/client";
import { FootballDataProvider } from "@/server/providers/football-data/provider";
import { ProviderError } from "@/server/providers/types";

const fixture = readFileSync(
  new URL("../fixtures/football-data/pl-matches.json", import.meta.url),
  "utf8",
);

function providerReturning(body: string, status = 200) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(body, { status });
  }) as typeof fetch;
  return {
    provider: new FootballDataProvider(new FootballDataClient({ token: "t", fetchImpl })),
    urls,
  };
}

const query = { competitionCode: "PL", dateFrom: "2026-11-02", dateTo: "2026-11-11" };

describe("FootballDataProvider.getMatches", () => {
  it("строит агрегированный запрос по соревнованию с фильтром дат", async () => {
    const { provider, urls } = providerReturning(fixture);
    await provider.getMatches(query);
    expect(urls).toEqual([
      "https://api.football-data.org/v4/competitions/PL/matches?dateFrom=2026-11-02&dateTo=2026-11-11",
    ]);
  });

  it("разбирает реальную форму ответа; некорректные элементы отбрасываются и считаются", async () => {
    const { provider } = providerReturning(fixture);
    const batch = await provider.getMatches(query);
    expect(batch.matches.map((m) => m.providerId)).toEqual(["560634", "560612", "560613"]);
    expect(batch.invalidCount).toBe(3);
  });

  it("предстоящий матч: TIMED → SCHEDULED, без итога", async () => {
    const { provider } = providerReturning(fixture);
    const upcoming = (await provider.getMatches(query)).matches[0]!;
    expect(upcoming.status).toBe("SCHEDULED");
    expect(upcoming.resultKind).toBe("NONE");
    expect(upcoming.homeScore).toBeNull();
    expect(upcoming.kickoffAt).toBe("2026-11-06T20:00:00.000Z");
    expect(upcoming.providerUpdatedAt).toBe("2026-11-04T00:20:29.000Z");
    expect(upcoming.competition).toEqual({
      providerId: "2021",
      code: "PL",
      name: "Premier League",
    });
    expect(upcoming.home).toEqual({ providerId: "62", name: "Everton FC", shortName: "Everton" });
  });

  it("завершенные матчи получают итог основного времени", async () => {
    const { provider } = providerReturning(fixture);
    const [, home, away] = (await provider.getMatches(query)).matches;
    expect([home?.resultKind, home?.homeScore, home?.awayScore]).toEqual(["REGULAR", 2, 0]);
    expect([away?.resultKind, away?.homeScore, away?.awayScore]).toEqual(["REGULAR", 0, 2]);
  });

  it("пустой список — не ошибка", async () => {
    const { provider } = providerReturning('{"matches":[]}');
    expect(await provider.getMatches(query)).toEqual({ matches: [], invalidCount: 0 });
  });

  it("неожиданная форма ответа — INVALID_RESPONSE", async () => {
    const { provider } = providerReturning('{"items":[]}');
    let error: unknown;
    try {
      await provider.getMatches(query);
    } catch (e) {
      error = e;
    }
    expect(error instanceof ProviderError && error.kind).toBe("INVALID_RESPONSE");
  });

  it("не ходит в сеть с некорректным кодом или диапазоном", async () => {
    const { provider, urls } = providerReturning(fixture);
    for (const bad of [
      { ...query, competitionCode: "../x" },
      { ...query, dateTo: "2026-11-30" },
      { ...query, dateFrom: "2026-11-12" },
      { ...query, dateFrom: "2026-02-30" },
    ]) {
      let thrown = false;
      try {
        await provider.getMatches(bad);
      } catch {
        thrown = true;
      }
      expect(thrown).toBe(true);
    }
    expect(urls).toHaveLength(0);
  });
});
