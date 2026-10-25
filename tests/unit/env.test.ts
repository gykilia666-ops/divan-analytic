import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "@/lib/env";

const SECRET = "super-secret-value-that-must-never-leak-123456";

const connected = {
  APP_DATA_MODE: "connected",
  APP_ORIGIN: "http://localhost:3000",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pub-key",
  SUPABASE_SERVICE_ROLE_KEY: SECRET,
  CRON_SECRET: "x".repeat(40),
};

function problemsOf(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (e) {
    if (e instanceof EnvValidationError) return e.problems;
    throw e;
  }
  return [];
}

describe("parseEnv: demo", () => {
  it("пустое окружение даёт demo + fixtures без ключей", () => {
    const env = parseEnv({});
    expect(env.APP_DATA_MODE).toBe("demo");
    expect(env.SPORTS_PROVIDER).toBe("fixtures");
  });
  it("пустые строки из .env считаются незаданными", () => {
    expect(parseEnv({ APP_DATA_MODE: "", SPORTS_PROVIDER: "" }).APP_DATA_MODE).toBe("demo");
  });
  it("demo + football-data — противоречие", () => {
    const p = problemsOf({ APP_DATA_MODE: "demo", SPORTS_PROVIDER: "football-data", FOOTBALL_DATA_API_KEY: "k" });
    expect(p.join("\n")).toMatch(/SPORTS_PROVIDER/);
  });
  it("неизвестный режим отклоняется", () => {
    expect(problemsOf({ APP_DATA_MODE: "prod" }).length).toBeGreaterThan(0);
  });
});

describe("parseEnv: connected", () => {
  it("полный набор проходит (fixtures-провайдер допустим для локальной интеграции)", () => {
    expect(parseEnv(connected).APP_DATA_MODE).toBe("connected");
  });
  it("требует Supabase, APP_ORIGIN и CRON_SECRET", () => {
    const p = problemsOf({ APP_DATA_MODE: "connected" }).join("\n");
    for (const k of [
      "APP_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET",
    ]) expect(p).toContain(k);
  });
  it("CRON_SECRET короче 32 символов отклоняется", () => {
    expect(problemsOf({ ...connected, CRON_SECRET: "short" }).join("\n")).toMatch(/CRON_SECRET/);
  });
  it("заглушки из .env.example не считаются значениями", () => {
    const p = problemsOf({ ...connected, SUPABASE_SERVICE_ROLE_KEY: "replace-me" }).join("\n");
    expect(p).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe("parseEnv: football-data", () => {
  it("требует FOOTBALL_DATA_API_KEY", () => {
    const p = problemsOf({ ...connected, SPORTS_PROVIDER: "football-data" }).join("\n");
    expect(p).toMatch(/FOOTBALL_DATA_API_KEY/);
  });
  it("с ключом проходит", () => {
    const env = parseEnv({ ...connected, SPORTS_PROVIDER: "football-data", FOOTBALL_DATA_API_KEY: "tok" });
    expect(env.SPORTS_PROVIDER).toBe("football-data");
  });
});

describe("parseEnv: безопасность", () => {
  it("секрет через NEXT_PUBLIC_* отклоняется", () => {
    const p = problemsOf({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: SECRET }).join("\n");
    expect(p).toMatch(/NEXT_PUBLIC_/);
  });
  it("публичный publishable key не считается утечкой", () => {
    expect(problemsOf({ ...connected }).join("\n")).not.toMatch(/PUBLISHABLE/);
  });
  it("значения секретов не попадают в текст ошибок", () => {
    const messages = [
      problemsOf({ ...connected, CRON_SECRET: SECRET.slice(0, 10) }),
      problemsOf({ NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: SECRET }),
      problemsOf({ APP_DATA_MODE: SECRET }),
    ].flat().join("\n");
    expect(messages).not.toContain(SECRET);
    expect(messages).not.toContain(SECRET.slice(0, 10));
  });
});
