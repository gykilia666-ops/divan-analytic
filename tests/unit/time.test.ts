import { describe, expect, it } from "vitest";
import { addMinutes, fixedClock, formatKickoff, isValidTimeZone, KRASNOYARSK_TZ } from "@/lib/time";

describe("fixedClock", () => {
  it("возвращает фиксированный момент", () => {
    expect(fixedClock("2026-10-26T12:00:00Z").now().toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });
  it("отдаёт копию: мутация не ломает часы", () => {
    const c = fixedClock("2026-10-26T12:00:00Z");
    c.now().setUTCFullYear(1999);
    expect(c.now().toISOString()).toBe("2026-10-26T12:00:00.000Z");
  });
  it("отклоняет некорректную дату", () => {
    expect(() => fixedClock("not-a-date")).toThrow();
  });
});

describe("formatKickoff", () => {
  it("Красноярск — UTC+7, зона указана явно", () => {
    const text = formatKickoff("2026-10-26T12:00:00Z", KRASNOYARSK_TZ);
    expect(text).toContain("19:00");
    expect(text).toContain("(Asia/Krasnoyarsk)");
  });
  it("граница суток: 18:30Z — уже следующий день в Красноярске", () => {
    expect(formatKickoff("2026-10-26T18:30:00Z", KRASNOYARSK_TZ)).toMatch(/^27 окт\.?,? 01:30/);
  });
  it("не принимает «голую» дату без зоны", () => {
    expect(() => formatKickoff("2026-10-26T12:00:00", "UTC")).toThrow(/с зоной/);
  });
  it("не принимает неизвестную зону", () => {
    expect(() => formatKickoff("2026-10-26T12:00:00Z", "Mars/Olympus")).toThrow(/неизвестная зона/);
  });
});

describe("helpers", () => {
  it("isValidTimeZone", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
  it("addMinutes", () => {
    expect(addMinutes("2026-10-26T12:00:00.000Z", 3)).toBe("2026-10-26T12:03:00.000Z");
  });
});
