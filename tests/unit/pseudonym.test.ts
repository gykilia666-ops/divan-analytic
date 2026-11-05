import { describe, expect, it } from "vitest";
import {
  checkPseudonym,
  normalizePseudonym,
  PSEUDONYM_ERROR_MESSAGES,
  PSEUDONYM_MAX,
  PSEUDONYM_MIN,
} from "@/lib/pseudonym";

describe("checkPseudonym", () => {
  it("принимает буквы двух алфавитов, цифры и допустимые знаки", () => {
    for (const name of ["Тихий Форвард", "Alice_7", "Иван.К-2", "abc", "Ёжик 99"]) {
      expect(checkPseudonym(name)).toEqual({ ok: true, name });
    }
  });

  it("нормализует пробелы: края убираются, повторные схлопываются", () => {
    expect(checkPseudonym("  Тихий   Форвард ")).toEqual({ ok: true, name: "Тихий Форвард" });
    expect(normalizePseudonym("a\t\nb")).toBe("a b");
  });

  it("границы длины: 2 и 25 символов нельзя, 3 и 24 можно", () => {
    expect(PSEUDONYM_MIN).toBe(3);
    expect(PSEUDONYM_MAX).toBe(24);
    expect(checkPseudonym("ab").ok).toBe(false);
    expect(checkPseudonym("abc").ok).toBe(true);
    expect(checkPseudonym("я".repeat(24)).ok).toBe(true);
    expect(checkPseudonym("я".repeat(25)).ok).toBe(false);
  });

  it("отклоняет недопустимые символы и начало со знака", () => {
    for (const name of [
      "a<b>c",
      "<script>",
      "_начало",
      "-начало",
      ".начало",
      "Игрок😀",
      "имя/слэш",
      "имя@почта",
      "имя\u0000nul",
    ]) {
      expect(checkPseudonym(name).ok, name).toBe(false);
    }
  });

  it("пустое значение и одни пробелы отклоняются", () => {
    expect(checkPseudonym("").ok).toBe(false);
    expect(checkPseudonym("     ").ok).toBe(false);
  });

  it("при отказе возвращает понятное сообщение", () => {
    const result = checkPseudonym("a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(PSEUDONYM_ERROR_MESSAGES.INVALID_NAME);
  });
});

describe("сообщения об ошибках", () => {
  it("для каждого кода ответа БД есть непустой русский текст", () => {
    const codes = [
      "INVALID_NAME",
      "RESERVED_NAME",
      "MATCHES_ACCOUNT",
      "NAME_TAKEN",
      "RATE_LIMITED",
      "ACCOUNT_NOT_FOUND",
      "ACCOUNT_DISABLED",
      "ALREADY_SET",
    ] as const;
    for (const code of codes) {
      expect(PSEUDONYM_ERROR_MESSAGES[code]).toMatch(/[А-Яа-я]/);
    }
  });
});
