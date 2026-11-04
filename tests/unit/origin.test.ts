import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "@/lib/origin";

const APP = "http://localhost:3000";

describe("isAllowedOrigin", () => {
  it("принимает тот же origin", () => {
    expect(isAllowedOrigin("http://localhost:3000", APP)).toBe(true);
  });
  it("игнорирует путь и завершающий слеш в APP_ORIGIN", () => {
    expect(isAllowedOrigin("http://localhost:3000", "http://localhost:3000/")).toBe(true);
  });
  it("отклоняет чужой хост, другой порт и другую схему", () => {
    expect(isAllowedOrigin("http://evil.com", APP)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001", APP)).toBe(false);
    expect(isAllowedOrigin("https://localhost:3000", APP)).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1:3000", APP)).toBe(false);
  });
  it("отклоняет отсутствующий, null и мусорный Origin", () => {
    expect(isAllowedOrigin(null, APP)).toBe(false);
    expect(isAllowedOrigin("null", APP)).toBe(false);
    expect(isAllowedOrigin("not a url", APP)).toBe(false);
  });
  it("отклоняет всё, если APP_ORIGIN не задан", () => {
    expect(isAllowedOrigin("http://localhost:3000", undefined)).toBe(false);
  });
  it("не принимает поддомен-обманку", () => {
    expect(isAllowedOrigin("http://localhost:3000.evil.com", APP)).toBe(false);
  });
});
