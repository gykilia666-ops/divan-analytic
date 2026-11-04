import { describe, expect, it } from "vitest";
import { computeDemoOdds } from "@/domain/odds/demo-odds";
import { DEMO_MATCHES } from "@/fixtures/demo-matches";
import { getDemoCatalog, getDemoMatch } from "@/server/catalog/demo-catalog";
import { parseCatalogQuery } from "@/server/catalog/parse-query";

const byScenario = (s: string) => {
  const id = DEMO_MATCHES.find((m) => m.scenario === s)!.id;
  return getDemoMatch(id)!;
};

describe("getDemoCatalog", () => {
  it("«Все» — 12 матчей по времени начала", () => {
    const page = getDemoCatalog(parseCatalogQuery({ scope: "all" }));
    expect(page.items).toHaveLength(12);
    const times = page.items.map((m) => m.kickoffAt);
    expect(times).toEqual([...times].sort());
    expect(page.nextCursor).toBeNull();
    expect(page.source).toBe("demo");
  });

  it("по умолчанию — только матчи, на которые можно сделать прогноз", () => {
    const ids = getDemoCatalog(parseCatalogQuery({})).items.map((m) => m.id);
    // Предстоящий и с устаревшими данными (временное состояние); без «через 3 минуты»,
    // перенесенного, прерванного и завершенных.
    expect(ids).toEqual(["demo-012", "demo-001"]);
  });

  it("предстоящие и завершенные", () => {
    const upcoming = getDemoCatalog(parseCatalogQuery({ scope: "upcoming" })).items;
    const finished = getDemoCatalog(parseCatalogQuery({ scope: "finished" })).items;
    expect(upcoming).toHaveLength(5);
    expect(finished).toHaveLength(7);
    const times = finished.map((m) => m.kickoffAt);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("фильтр по дате считается в выбранной зоне", () => {
    const krsk = getDemoCatalog(
      parseCatalogQuery({ date: "2026-10-26", tz: "Asia/Krasnoyarsk", scope: "all" }),
    );
    expect(krsk.items.map((m) => m.id).sort()).toEqual([
      "demo-002",
      "demo-008",
      "demo-009",
      "demo-010",
      "demo-012",
    ]);
    const tomorrowUtc = getDemoCatalog(
      parseCatalogQuery({ date: "2026-10-27", tz: "UTC", scope: "all" }),
    );
    expect(tomorrowUtc.items.map((m) => m.id)).toEqual(["demo-007"]);
  });

  it("чужое соревнование — пусто", () => {
    expect(getDemoCatalog(parseCatalogQuery({ competition: "PL" })).items).toHaveLength(0);
  });

  it("пагинация без пропусков и повторов", () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = getDemoCatalog(
        parseCatalogQuery({ scope: "all", limit: "5", ...(cursor ? { cursor } : {}) }),
      );
      seen.push(...page.items.map((m) => m.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });

  it("пагинация завершенных идет по убыванию", () => {
    const first = getDemoCatalog(parseCatalogQuery({ scope: "finished", limit: "4" }));
    const second = getDemoCatalog(
      parseCatalogQuery({ scope: "finished", limit: "4", cursor: first.nextCursor! }),
    );
    expect(second.items).toHaveLength(3);
    expect(second.items[0]!.kickoffAt <= first.items[3]!.kickoffAt).toBe(true);
  });
});

describe("состояние приема в демо", () => {
  it("предстоящий матч открыт, коэффициенты совпадают с детерминированной функцией", () => {
    const m = byScenario("UPCOMING");
    expect(m.acceptance.reason).toBe("OPEN");
    expect(m.market?.odds).toEqual(computeDemoOdds("fixtures", m.id));
  });

  it("матч через 3 минуты: рынок еще OPEN, но прием закрыт временем", () => {
    const m = byScenario("CLOSING_SOON");
    expect(m.market?.status).toBe("OPEN");
    expect([m.acceptance.accepting, m.acceptance.reason]).toEqual([false, "CUTOFF"]);
  });

  it("устаревшие данные", () => {
    const m = byScenario("STALE_DATA");
    expect([m.stale, m.acceptance.reason]).toEqual([true, "STALE"]);
  });

  it("завершенный, отмененный и перенесенный матчи не принимают прогнозы", () => {
    expect(byScenario("HOME_WIN").acceptance.reason).toBe("MARKET_NOT_OPEN");
    expect(byScenario("CANCELLED").market?.status).toBe("SUSPENDED");
    expect(byScenario("POSTPONED").acceptance.accepting).toBe(false);
  });

  it("неоднозначный итог и пустой счет не показываются как счет", () => {
    expect(byScenario("AMBIGUOUS_RESULT").homeScore).toBeNull();
    expect(byScenario("AMBIGUOUS_RESULT").resultKind).toBe("AMBIGUOUS");
    expect(byScenario("NULL_SCORE").homeScore).toBeNull();
  });

  it("неизвестный матч", () => {
    expect(getDemoMatch("nope")).toBeNull();
  });
});
