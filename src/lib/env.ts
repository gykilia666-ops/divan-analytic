import { z } from "zod";

/**
 * Валидация окружения по режимам (CLAUDE.md §13.3, §15.1).
 * - demo: не требует никаких ключей.
 * - connected: требует Supabase + CRON_SECRET + APP_ORIGIN.
 * - football-data: требует ключ и режим connected.
 * Значения секретов НИКОГДА не попадают в текст ошибок.
 */

export const DATA_MODES = ["demo", "connected"] as const;
export const SPORTS_PROVIDERS = ["fixtures", "football-data"] as const;
export type DataMode = (typeof DATA_MODES)[number];
export type SportsProviderId = (typeof SPORTS_PROVIDERS)[number];

const PLACEHOLDER_PREFIX = "replace-me";

const schema = z
  .object({
    APP_DATA_MODE: z.enum(DATA_MODES).default("demo"),
    SPORTS_PROVIDER: z.enum(SPORTS_PROVIDERS).default("fixtures"),
    APP_ORIGIN: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    FOOTBALL_DATA_API_KEY: z.string().min(1).optional(),
    CRON_SECRET: z.string().min(32).optional(),
  })
  .superRefine((env, ctx) => {
    const need = (key: keyof typeof env, why: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `${key} обязателен: ${why}` });
      }
    };

    if (env.APP_DATA_MODE === "demo" && env.SPORTS_PROVIDER !== "fixtures") {
      ctx.addIssue({
        code: "custom",
        path: ["SPORTS_PROVIDER"],
        message: "в режиме demo допустим только SPORTS_PROVIDER=fixtures",
      });
    }

    if (env.APP_DATA_MODE === "connected") {
      const why = "режим connected";
      need("APP_ORIGIN", why);
      need("NEXT_PUBLIC_SUPABASE_URL", why);
      need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", why);
      need("SUPABASE_SERVICE_ROLE_KEY", why);
      need("CRON_SECRET", why);
    }

    if (env.SPORTS_PROVIDER === "football-data") {
      need("FOOTBALL_DATA_API_KEY", "SPORTS_PROVIDER=football-data");
    }
  });

export type AppEnv = z.infer<typeof schema>;

export class EnvValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Некорректное окружение:\n- ${problems.join("\n- ")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

type Source = Record<string, string | undefined>;

/** Секреты нельзя выставлять через NEXT_PUBLIC_*: такие переменные попадают в браузерный бандл. */
const PUBLIC_SECRET_NAME = /^NEXT_PUBLIC_.*(SERVICE_ROLE|SECRET|API_KEY|PRIVATE)/i;

export function parseEnv(source: Source): AppEnv {
  const problems: string[] = [];

  for (const key of Object.keys(source)) {
    if (PUBLIC_SECRET_NAME.test(key) && source[key]) {
      problems.push(`${key}: секреты нельзя передавать через NEXT_PUBLIC_*`);
    }
  }

  // Пустая строка из .env трактуется как «не задано»; заглушки из .env.example отклоняем.
  const cleaned: Source = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value.trim() === "") continue;
    if (value.startsWith(PLACEHOLDER_PREFIX) && key !== "APP_DATA_MODE") {
      // Заглушка допустима только пока ключ не нужен; в connected она даст ошибку «обязателен».
      continue;
    }
    cleaned[key] = value;
  }

  const result = schema.safeParse(cleaned);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      // Только message и путь — значение поля в сообщение не включаем.
      problems.push(`${where}${issue.message}`);
    }
    throw new EnvValidationError(problems);
  }

  if (problems.length > 0) throw new EnvValidationError(problems);
  return result.data;
}

let cached: AppEnv | undefined;

/** Серверное окружение. Не импортировать из клиентских компонентов. */
export function getEnv(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Единственное, что можно отдавать в UI: без секретов и ключей. */
export function getPublicConfig(): { dataMode: DataMode } {
  return { dataMode: getEnv().APP_DATA_MODE };
}

/** Только для тестов. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
}
