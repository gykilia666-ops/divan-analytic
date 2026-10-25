import { describe, expect, it } from "vitest";
import { DEMO_MATCHES, DEMO_NOW, PROVIDER_FAULTS, type FixtureScenario } from "@/fixtures/demo-matches";

const byScenario = (s: FixtureScenario) => {
  const found = DEMO_MATCHES.find((m) => m.scenario === s);
  if (!found) throw new Error(`нет сценария ${s}`);
  return found;
};

describe("demo fixtures (CLAUDE.md §15.3)", () => {
  it("id уникальны", () => {
    const ids = DEMO_MATCHES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("покрывает все обязательные матчевые сценарии", () => {
    const required: FixtureScenario[] = [
      "UPCOMING", "CLOSING_SOON", "HOME_WIN", "AWAY_WIN", "DRAW", "CANCELLED", "POSTPONED",
      "SUSPENDED", "NULL_SCORE", "AMBIGUOUS_RESULT", "RESULT_CHANGED_AFTER_SETTLEMENT", "STALE_DATA",
    ];
    const present = new Set(DEMO_MATCHES.map((m) => m.scenario));
    for (const s of required) expect(present.has(s), s).toBe(true);
  });

  it("матч «через 3 минуты» отстоит от якоря ровно на 3 минуты", () => {
    const diff = new Date(byScenario("CLOSING_SOON").kickoffAt).getTime() - new Date(DEMO_NOW).getTime();
    expect(diff).toBe(3 * 60_000);
  });

  it("счета согласованы со сценарием; null не равен 0", () => {
    const nul = byScenario("NULL_SCORE");
    expect(nul.homeScore).toBeNull();
    expect(nul.awayScore).toBeNull();
    const h = byScenario("HOME_WIN");
    expect(h.homeScore! > h.awayScore!).toBe(true);
    const a = byScenario("AWAY_WIN");
    expect(a.homeScore! < a.awayScore!).toBe(true);
    const d = byScenario("DRAW");
    expect(d.homeScore).toBe(d.awayScore);
  });

  it("устаревшие данные старше 60 минут относительно якоря", () => {
    const stale = byScenario("STALE_DATA");
    const age = new Date(DEMO_NOW).getTime() - new Date(stale.providerUpdatedAt!).getTime();
    expect(age).toBeGreaterThan(60 * 60_000);
  });

  it("завершённые матчи (кроме NULL_SCORE) имеют обе стороны счета", () => {
    for (const m of DEMO_MATCHES) {
      if (m.status === "FINISHED" && m.scenario !== "NULL_SCORE") {
        expect(m.homeScore, m.id).not.toBeNull();
        expect(m.awayScore, m.id).not.toBeNull();
      }
    }
  });

  it("сбои поставщика: 429, timeout, частично некорректный ответ", () => {
    expect(PROVIDER_FAULTS.map((f) => f.kind)).toEqual([
      "RATE_LIMITED", "TIMEOUT", "PARTIAL_INVALID_RESPONSE",
    ]);
  });
});
