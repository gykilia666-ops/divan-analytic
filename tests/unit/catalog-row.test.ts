import { describe, expect, it } from "vitest";
import { catalogRowSchema, rowToCatalog } from "@/server/catalog/catalog-row";

const row = {
  id: "0b6f2f0e-1111-4222-8333-944444444444",
  competition_code: "PL",
  competition_name: "Premier League",
  home_name: "Everton FC",
  away_name: "Coventry City FC",
  kickoff_at: "2026-11-06T20:00:00+00:00",
  status: "SCHEDULED",
  home_score: null,
  away_score: null,
  result_kind: "NONE",
  last_seen_at: "2026-11-06T19:30:00+00:00",
  market_id: "1b6f2f0e-1111-4222-8333-944444444444",
  market_status: "OPEN",
  quote_version: 1,
  model_version: "demo-v1",
  home_odds_milli: 1836,
  draw_odds_milli: 4345,
  away_odds_milli: 3503,
  db_now: "2026-11-06T19:40:00.123+00:00",
};

describe("rowToCatalog", () => {
  it("строка витрины → матч каталога; время по часам БД", () => {
    const m = rowToCatalog(catalogRowSchema.parse(row));
    expect(m.kickoffAt).toBe("2026-11-06T20:00:00.000Z");
    expect(m.market?.odds).toEqual({ home: 1836, draw: 4345, away: 3503 });
    expect(m.acceptance).toEqual({
      accepting: true,
      reason: "OPEN",
      closesAt: "2026-11-06T19:55:00.000Z",
    });
    expect(m.stale).toBe(false);
  });

  it("матч без рынка", () => {
    const m = rowToCatalog(
      catalogRowSchema.parse({
        ...row,
        market_id: null,
        market_status: null,
        quote_version: null,
        model_version: null,
        home_odds_milli: null,
        draw_odds_milli: null,
        away_odds_milli: null,
      }),
    );
    expect(m.market).toBeNull();
    expect(m.acceptance.reason).toBe("NO_MARKET");
  });

  it("часы БД закрывают прием", () => {
    const m = rowToCatalog(catalogRowSchema.parse({ ...row, db_now: "2026-11-06T19:56:00+00:00" }));
    expect(m.acceptance.reason).toBe("CUTOFF");
  });

  it("неизвестный статус отклоняется схемой", () => {
    expect(catalogRowSchema.safeParse({ ...row, status: "WEIRD" }).success).toBe(false);
  });
});
