import { describe, expect, it } from "vitest";
import { isValidYmd, todayInZone, zonedDayToUtcRange, zoneOffsetMinutes } from "@/lib/day-range";

describe("zonedDayToUtcRange", () => {
  it("UTC: сутки как есть", () => {
    expect(zonedDayToUtcRange("2026-11-05", "UTC")).toEqual({
      from: "2026-11-05T00:00:00.000Z",
      to: "2026-11-06T00:00:00.000Z",
    });
  });

  it("Asia/Krasnoyarsk (UTC+7): сутки начинаются в 17:00 UTC предыдущего дня", () => {
    expect(zonedDayToUtcRange("2026-11-05", "Asia/Krasnoyarsk")).toEqual({
      from: "2026-11-04T17:00:00.000Z",
      to: "2026-11-05T17:00:00.000Z",
    });
  });

  it("Europe/Berlin, переход на зимнее время: сутки длиной 25 часов", () => {
    expect(zonedDayToUtcRange("2026-10-25", "Europe/Berlin")).toEqual({
      from: "2026-10-24T22:00:00.000Z",
      to: "2026-10-25T23:00:00.000Z",
    });
  });

  it("Europe/Berlin, переход на летнее время: сутки длиной 23 часа", () => {
    expect(zonedDayToUtcRange("2026-03-29", "Europe/Berlin")).toEqual({
      from: "2026-03-28T23:00:00.000Z",
      to: "2026-03-29T22:00:00.000Z",
    });
  });

  it("конец месяца и года", () => {
    expect(zonedDayToUtcRange("2026-12-31", "Asia/Krasnoyarsk")).toEqual({
      from: "2026-12-30T17:00:00.000Z",
      to: "2026-12-31T17:00:00.000Z",
    });
  });

  it("некорректные дата и зона отклоняются", () => {
    expect(() => zonedDayToUtcRange("2026-02-30", "UTC")).toThrow();
    expect(() => zonedDayToUtcRange("2026-11-05", "Mars/Olympus")).toThrow();
  });
});

describe("helpers", () => {
  it("zoneOffsetMinutes", () => {
    expect(zoneOffsetMinutes(new Date("2026-11-05T00:00:00Z"), "Asia/Krasnoyarsk")).toBe(420);
    expect(zoneOffsetMinutes(new Date("2026-07-01T00:00:00Z"), "Europe/Berlin")).toBe(120);
  });
  it("isValidYmd", () => {
    expect(isValidYmd("2026-11-05")).toBe(true);
    expect(isValidYmd("2026-02-29")).toBe(false);
    expect(isValidYmd("2026-11-5")).toBe(false);
  });
  it("todayInZone: в Красноярске уже следующий день", () => {
    const now = new Date("2026-11-04T18:30:00Z");
    expect(todayInZone(now, "UTC")).toBe("2026-11-04");
    expect(todayInZone(now, "Asia/Krasnoyarsk")).toBe("2026-11-05");
  });
});
