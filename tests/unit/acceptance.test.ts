import { describe, expect, it } from "vitest";
import { acceptanceState, isStale } from "@/domain/markets/acceptance";

const KICKOFF = "2026-11-06T20:00:00.000Z";
const base = {
  marketStatus: "OPEN" as const,
  matchStatus: "SCHEDULED" as const,
  kickoffAt: KICKOFF,
  lastSeenAt: "2026-11-06T19:30:00.000Z",
  now: "2026-11-06T19:40:00.000Z",
};

describe("acceptanceState", () => {
  it("открыт, если рынок OPEN, матч запланирован, до старта > 5 минут, данные свежие", () => {
    expect(acceptanceState(base)).toEqual({
      accepting: true,
      reason: "OPEN",
      closesAt: "2026-11-06T19:55:00.000Z",
    });
  });

  it("ровно за 5 минут до старта прием уже закрыт", () => {
    expect(acceptanceState({ ...base, now: "2026-11-06T19:55:00.000Z" }).reason).toBe("CUTOFF");
  });

  it("за 5 минут и 1 мс до старта прием еще открыт", () => {
    expect(acceptanceState({ ...base, now: "2026-11-06T19:54:59.999Z" }).accepting).toBe(true);
  });

  it("время закрывает прием, даже если рынок все еще OPEN и статус не обновлен", () => {
    const r = acceptanceState({
      ...base,
      now: "2026-11-06T20:30:00.000Z",
      lastSeenAt: "2026-11-06T20:00:00.000Z",
    });
    expect([r.accepting, r.reason]).toEqual([false, "CUTOFF"]);
  });

  it("нет рынка", () => {
    expect(acceptanceState({ ...base, marketStatus: null }).reason).toBe("NO_MARKET");
  });

  it("рынок не открыт", () => {
    for (const s of ["SUSPENDED", "CLOSED", "RESOLVED", "VOID"] as const) {
      expect(acceptanceState({ ...base, marketStatus: s }).reason).toBe("MARKET_NOT_OPEN");
    }
  });

  it("матч уже не запланирован", () => {
    for (const s of ["LIVE", "FINISHED", "POSTPONED", "SUSPENDED", "CANCELLED"] as const) {
      expect(acceptanceState({ ...base, matchStatus: s }).reason).toBe("MATCH_NOT_SCHEDULED");
    }
  });

  it("устаревшие данные запрещают прием", () => {
    expect(acceptanceState({ ...base, lastSeenAt: "2026-11-06T18:39:59.999Z" }).reason).toBe(
      "STALE",
    );
    expect(acceptanceState({ ...base, lastSeenAt: null }).reason).toBe("STALE");
  });

  it("некорректное время — ошибка, а не молчаливое «открыто»", () => {
    expect(() => acceptanceState({ ...base, now: "nope" })).toThrow();
  });
});

describe("isStale", () => {
  it("ровно 60 минут — еще свежие, больше — устаревшие", () => {
    expect(isStale("2026-11-06T18:40:00.000Z", "2026-11-06T19:40:00.000Z")).toBe(false);
    expect(isStale("2026-11-06T18:39:59.999Z", "2026-11-06T19:40:00.000Z")).toBe(true);
    expect(isStale(null, "2026-11-06T19:40:00.000Z")).toBe(true);
  });
});
