import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import { LEGAL_LINKS, PROCESSORS, resolveOperator } from "@/lib/legal";
import { LEGAL_VERSION, LEGAL_VERSION_LABEL } from "@/lib/legal-version";

describe("resolveOperator", () => {
  const full = {
    name: "Иванов Иван Иванович",
    email: "owner@example.com",
  };

  it("полные данные — complete", () => {
    expect(resolveOperator(full)).toEqual({ ...full, complete: true });
  });

  it("пробелы и переводы строк нормализуются, угловые скобки вырезаются", () => {
    const op = resolveOperator({ name: "  Иван\n  <Иванов> ", email: " a@b.co " });
    expect(op.name).toBe("Иван Иванов");
    expect(op.email).toBe("a@b.co");
  });

  it("не хватает любого поля — не complete", () => {
    expect(resolveOperator({ ...full, name: undefined }).complete).toBe(false);
    expect(resolveOperator({ ...full, email: undefined }).complete).toBe(false);
    expect(resolveOperator({ ...full, name: "   " }).complete).toBe(false);
    expect(resolveOperator({}).complete).toBe(false);
  });

  it("почта без домена не принимается и не показывается", () => {
    for (const email of ["owner", "owner@", "@example.com", "owner@example", "a b@c.de"]) {
      const op = resolveOperator({ ...full, email });
      expect(op.email).toBeNull();
      expect(op.complete).toBe(false);
    }
  });
});

describe("окружение оператора", () => {
  it("LEGAL_OPERATOR_* необязательны и в demo, и в connected-проверке схемы", () => {
    const env = parseEnv({ APP_DATA_MODE: "demo" });
    expect(env.LEGAL_OPERATOR_NAME).toBeUndefined();
  });

  it("заглушка replace-me из .env.example считается незаданной", () => {
    const env = parseEnv({
      APP_DATA_MODE: "demo",
      LEGAL_OPERATOR_NAME: "replace-me",
      LEGAL_OPERATOR_EMAIL: "replace-me",
    });
    expect(env.LEGAL_OPERATOR_NAME).toBeUndefined();
    expect(env.LEGAL_OPERATOR_EMAIL).toBeUndefined();
    expect(env.LEGAL_OPERATOR_EMAIL).toBeUndefined();
  });

  it("реальные значения проходят", () => {
    const env = parseEnv({ APP_DATA_MODE: "demo", LEGAL_OPERATOR_NAME: "Иванов И. И." });
    expect(env.LEGAL_OPERATOR_NAME).toBe("Иванов И. И.");
  });
});

describe("пакет документов", () => {
  it("версия в формате, который проверяет БД (user_consents_version_format)", () => {
    expect(LEGAL_VERSION).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });

  it("человекочитаемая дата соответствует версии", () => {
    const [y, m, d] = LEGAL_VERSION.split("-").map(Number);
    const months = [
      "января",
      "февраля",
      "марта",
      "апреля",
      "мая",
      "июня",
      "июля",
      "августа",
      "сентября",
      "октября",
      "ноября",
      "декабря",
    ];
    expect(LEGAL_VERSION_LABEL).toBe(`${d} ${months[(m ?? 1) - 1]} ${y} года`);
  });

  it("ссылки на документы уникальны и внутренние", () => {
    const hrefs = LEGAL_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\/[a-z/]+$/);
  });

  it("перечислены все получатели данных (Supabase, Vercel, GitHub)", () => {
    const names = PROCESSORS.map((p) => p.name).join(" ");
    expect(names).toContain("Supabase");
    expect(names).toContain("Vercel");
    expect(names).toContain("GitHub");
  });
});
