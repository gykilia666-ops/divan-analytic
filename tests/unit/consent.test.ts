import { describe, expect, it } from "vitest";
import { parseConsentCookie, serializeConsentCookie } from "@/lib/consent";
import { LEGAL_VERSION } from "@/lib/legal-version";

describe("cookie согласий", () => {
  it("круг сериализации принимается", () => {
    expect(parseConsentCookie(serializeConsentCookie())).toBe(true);
  });

  it("значение — версия документов", () => {
    expect(serializeConsentCookie()).toBe(LEGAL_VERSION);
  });

  it("устаревшая версия документов не засчитывается", () => {
    expect(parseConsentCookie("2020-01-01")).toBe(false);
    expect(parseConsentCookie("2020-01-01", "2020-01-01")).toBe(true);
  });

  it("отсутствующее и поврежденное значение — не согласие", () => {
    for (const raw of [
      undefined,
      null,
      "",
      "garbage",
      `${LEGAL_VERSION}.1`,
      `${LEGAL_VERSION}.0`,
    ]) {
      expect(parseConsentCookie(raw)).toBe(false);
    }
    expect(parseConsentCookie(`${LEGAL_VERSION};path=/`)).toBe(false);
    expect(parseConsentCookie(` ${LEGAL_VERSION}`)).toBe(false);
  });
});
