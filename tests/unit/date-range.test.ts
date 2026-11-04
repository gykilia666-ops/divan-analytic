import { describe, expect, it } from "vitest";
import { PROVIDER_MAX_RANGE_DAYS, computeSyncWindow, rangeDays } from "@/lib/date-range";

describe("computeSyncWindow", () => {
  it("2 дня назад и 7 дней вперед в UTC", () => {
    expect(computeSyncWindow(new Date("2026-11-04T09:00:00Z"))).toEqual({
      dateFrom: "2026-11-02",
      dateTo: "2026-11-11",
    });
  });
  it("граница суток считается в UTC, а не в зоне процесса", () => {
    expect(computeSyncWindow(new Date("2026-11-04T23:30:00Z"), 0, 0)).toEqual({
      dateFrom: "2026-11-04",
      dateTo: "2026-11-04",
    });
  });
  it("окно по умолчанию укладывается в лимит поставщика", () => {
    const w = computeSyncWindow(new Date("2026-11-04T00:00:00Z"));
    expect(rangeDays(w.dateFrom, w.dateTo)! <= PROVIDER_MAX_RANGE_DAYS).toBe(true);
  });
  it("некорректная дата отклоняется", () => {
    expect(() => computeSyncWindow(new Date("nope"))).toThrow();
  });
});

describe("rangeDays", () => {
  it("считает дни", () => {
    expect(rangeDays("2026-11-04", "2026-11-14")).toBe(10);
    expect(rangeDays("2026-11-04", "2026-11-04")).toBe(0);
    expect(rangeDays("2026-11-04", "2026-11-03")).toBe(-1);
  });
  it("некорректные даты дают null", () => {
    expect(rangeDays("2026-02-30", "2026-03-01")).toBeNull();
    expect(rangeDays("2026-11-4", "2026-11-14")).toBeNull();
    expect(rangeDays("", "2026-11-14")).toBeNull();
  });
});
