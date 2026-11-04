import { describe, expect, it } from "vitest";
import { DEMO_MATCHES, PROVIDER_FAULTS } from "@/fixtures/demo-matches";
import { FixtureSportsProvider, fixtureToMatchDTO } from "@/server/providers/fixtures/provider";
import { ProviderError } from "@/server/providers/types";

const query = { competitionCode: "LD", dateFrom: "2026-10-24", dateTo: "2026-11-02" };

function byScenario(s: string) {
  const m = DEMO_MATCHES.find((x) => x.scenario === s);
  if (!m) throw new Error(s);
  return fixtureToMatchDTO(m);
}

async function errorOf(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ProviderError) return e;
    throw e;
  }
  throw new Error("ожидалась ошибка");
}

describe("FixtureSportsProvider", () => {
  it("отдает все демо-матчи без сети", async () => {
    const batch = await new FixtureSportsProvider().getMatches(query);
    expect(batch.matches).toHaveLength(DEMO_MATCHES.length);
    expect(batch.invalidCount).toBe(0);
  });

  it("другое соревнование — пусто", async () => {
    const batch = await new FixtureSportsProvider().getMatches({ ...query, competitionCode: "PL" });
    expect(batch.matches).toHaveLength(0);
  });

  it("итоги: однозначный счет только у завершенных матчей", () => {
    expect([byScenario("HOME_WIN").resultKind, byScenario("HOME_WIN").homeScore]).toEqual([
      "REGULAR",
      2,
    ]);
    expect(byScenario("NULL_SCORE").resultKind).toBe("NONE");
    expect(byScenario("NULL_SCORE").homeScore).toBeNull();
    expect(byScenario("AMBIGUOUS_RESULT").resultKind).toBe("AMBIGUOUS");
    expect(byScenario("AMBIGUOUS_RESULT").homeScore).toBeNull();
    expect(byScenario("UPCOMING").resultKind).toBe("NONE");
    expect(byScenario("CANCELLED").status).toBe("CANCELLED");
  });

  it("сбои: 429, таймаут, частично некорректный ответ", async () => {
    const [rate, timeout, partial] = PROVIDER_FAULTS;
    const e429 = await errorOf(new FixtureSportsProvider({ fault: rate }).getMatches(query));
    expect([e429.kind, e429.retryAfterSeconds]).toEqual(["RATE_LIMITED", 42]);
    const eTimeout = await errorOf(new FixtureSportsProvider({ fault: timeout }).getMatches(query));
    expect(eTimeout.kind).toBe("TIMEOUT");
    const batch = await new FixtureSportsProvider({ fault: partial }).getMatches(query);
    expect(batch.matches.map((m) => m.providerId)).toEqual(["demo-001", "demo-003"]);
    expect(batch.invalidCount).toBe(2);
  });
});
