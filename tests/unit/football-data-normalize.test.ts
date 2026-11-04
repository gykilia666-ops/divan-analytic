import { describe, expect, it } from "vitest";
import { mapStatus, resolveResult, toUtcIso } from "@/server/providers/football-data/normalize";

describe("mapStatus", () => {
  it("маппит известные статусы явно", () => {
    expect(mapStatus("TIMED")).toBe("SCHEDULED");
    expect(mapStatus("SCHEDULED")).toBe("SCHEDULED");
    expect(mapStatus("IN_PLAY")).toBe("LIVE");
    expect(mapStatus("PAUSED")).toBe("LIVE");
    expect(mapStatus("FINISHED")).toBe("FINISHED");
    expect(mapStatus("POSTPONED")).toBe("POSTPONED");
    expect(mapStatus("SUSPENDED")).toBe("SUSPENDED");
    expect(mapStatus("CANCELLED")).toBe("CANCELLED");
  });
  it("неизвестный статус не угадывается", () => {
    expect(mapStatus("SOMETHING_NEW")).toBeNull();
    expect(mapStatus("finished")).toBeNull();
  });
});

describe("resolveResult (ADR-009)", () => {
  const empty = { home: null, away: null };

  it("незавершенный матч не имеет итога", () => {
    expect(resolveResult({ rawStatus: "TIMED", duration: "REGULAR", fullTime: empty })).toEqual({
      resultKind: "NONE",
      homeScore: null,
      awayScore: null,
    });
    expect(
      resolveResult({ rawStatus: "IN_PLAY", duration: "REGULAR", fullTime: { home: 1, away: 0 } })
        .resultKind,
    ).toBe("NONE");
  });

  it("FINISHED + REGULAR: fullTime — итог основного времени", () => {
    expect(
      resolveResult({ rawStatus: "FINISHED", duration: "REGULAR", fullTime: { home: 2, away: 0 } }),
    ).toEqual({ resultKind: "REGULAR", homeScore: 2, awayScore: 0 });
    expect(
      resolveResult({ rawStatus: "FINISHED", duration: "REGULAR", fullTime: { home: 0, away: 0 } }),
    ).toEqual({ resultKind: "REGULAR", homeScore: 0, awayScore: 0 });
  });

  it("FINISHED без счета — итога еще нет; null не равен 0", () => {
    expect(resolveResult({ rawStatus: "FINISHED", duration: "REGULAR", fullTime: empty })).toEqual({
      resultKind: "NONE",
      homeScore: null,
      awayScore: null,
    });
  });

  it("половина счета — неоднозначно", () => {
    expect(
      resolveResult({
        rawStatus: "FINISHED",
        duration: "REGULAR",
        fullTime: { home: 1, away: null },
      }).resultKind,
    ).toBe("AMBIGUOUS");
  });

  it("дополнительное время: fullTime не используется, берется regularTime", () => {
    expect(
      resolveResult({
        rawStatus: "FINISHED",
        duration: "PENALTY_SHOOTOUT",
        fullTime: { home: 7, away: 6 },
        regularTime: { home: 1, away: 1 },
      }),
    ).toEqual({ resultKind: "REGULAR", homeScore: 1, awayScore: 1 });
  });

  it("дополнительное время без regularTime — неоднозначно, без догадок", () => {
    expect(
      resolveResult({
        rawStatus: "FINISHED",
        duration: "EXTRA_TIME",
        fullTime: { home: 2, away: 1 },
      }),
    ).toEqual({ resultKind: "AMBIGUOUS", homeScore: null, awayScore: null });
    expect(
      resolveResult({ rawStatus: "FINISHED", duration: null, fullTime: { home: 2, away: 1 } })
        .resultKind,
    ).toBe("AMBIGUOUS");
  });

  it("технический результат (AWARDED) не рассчитывается", () => {
    expect(
      resolveResult({ rawStatus: "AWARDED", duration: "REGULAR", fullTime: { home: 3, away: 0 } })
        .resultKind,
    ).toBe("AMBIGUOUS");
  });
});

describe("toUtcIso", () => {
  it("нормализует в UTC", () => {
    expect(toUtcIso("2026-11-06T20:00:00Z")).toBe("2026-11-06T20:00:00.000Z");
    expect(toUtcIso("2026-11-07T03:00:00+07:00")).toBe("2026-11-06T20:00:00.000Z");
  });
  it("отклоняет время без зоны и мусор", () => {
    expect(toUtcIso("2026-11-06T20:00:00")).toBeNull();
    expect(toUtcIso("2026-11-06")).toBeNull();
    expect(toUtcIso("not a date")).toBeNull();
    expect(toUtcIso("2026-13-40T99:00:00Z")).toBeNull();
  });
});
