import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it("пустые значения ведут на главную", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });

  it("разрешает внутренние маршруты из белого списка", () => {
    expect(safeNextPath("/")).toBe("/");
    expect(safeNextPath("/matches")).toBe("/matches");
    expect(safeNextPath("/my/wallet")).toBe("/my/wallet");
    expect(safeNextPath("/my")).toBe("/my");
    expect(safeNextPath("/matches/abc?page=2")).toBe("/matches/abc?page=2");
  });

  it("отбрасывает фрагмент", () => {
    expect(safeNextPath("/matches#top")).toBe("/matches");
  });

  it("блокирует open redirect на внешние адреса", () => {
    for (const evil of [
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "\\\\evil.com",
      "https://evil.com",
      "http://evil.com/matches",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "evil.com",
      "@evil.com",
    ]) {
      expect(safeNextPath(evil), evil).toBe("/");
    }
  });

  it("блокирует управляющие символы и слишком длинные значения", () => {
    expect(safeNextPath("/matches\n")).toBe("/");
    expect(safeNextPath("/\t/evil.com")).toBe("/");
    expect(safeNextPath(`/matches?${"a".repeat(300)}`)).toBe("/");
  });

  it("неизвестные корни и похожие префиксы отклоняются", () => {
    expect(safeNextPath("/unknown")).toBe("/");
    expect(safeNextPath("/myevil")).toBe("/");
    expect(safeNextPath("/%2f%2fevil.com")).toBe("/");
    expect(safeNextPath("/auth/callback")).toBe("/");
  });
});
