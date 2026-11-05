import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Параметры ЛОКАЛЬНОГО Supabase для e2e в режиме connected. Берутся из переменных E2E_* (если заданы)
 * или из `supabase status -o json`. Ключи локального стенда стандартные и секретами не являются;
 * облачный проект здесь никогда не используется (проверка адреса ниже).
 */
export interface ConnectedEnv {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
  jwtSecret: string;
  dbUrl: string;
}

function fromStatus(): Record<string, string> {
  const out = execSync("npx supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const start = out.indexOf("{");
  return JSON.parse(out.slice(start)) as Record<string, string>;
}

let cached: ConnectedEnv | null = null;

export function connectedEnv(): ConnectedEnv {
  if (cached) return cached;
  const status =
    process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_SERVICE_KEY ? {} : fromStatus();
  const env: ConnectedEnv = {
    apiUrl: process.env.E2E_SUPABASE_URL ?? status.API_URL ?? "",
    anonKey: process.env.E2E_SUPABASE_ANON_KEY ?? status.ANON_KEY ?? status.PUBLISHABLE_KEY ?? "",
    serviceKey:
      process.env.E2E_SUPABASE_SERVICE_KEY ?? status.SERVICE_ROLE_KEY ?? status.SECRET_KEY ?? "",
    jwtSecret: process.env.E2E_SUPABASE_JWT_SECRET ?? status.JWT_SECRET ?? "",
    dbUrl:
      process.env.E2E_DATABASE_URL ??
      status.DB_URL ??
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  };
  const host = new URL(env.apiUrl).hostname;
  if (
    !["127.0.0.1", "localhost"].includes(host) ||
    !env.anonKey ||
    !env.serviceKey ||
    !env.jwtSecret
  ) {
    throw new Error("e2e connected работает только с локальным Supabase (npm run db:start)");
  }
  cached = env;
  return env;
}

export const E2E_PORT = 3300;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

/** Окружение сервера приложения: connected + fixtures, без football-data и без облака. */
export function serverEnv(): Record<string, string> {
  const env = connectedEnv();
  return {
    APP_DATA_MODE: "connected",
    SPORTS_PROVIDER: "fixtures",
    APP_ORIGIN: E2E_ORIGIN,
    NEXT_PUBLIC_SUPABASE_URL: env.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: env.serviceKey,
    CRON_SECRET: randomBytes(24).toString("hex"),
  };
}
