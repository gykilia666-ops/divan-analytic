import { ProviderError } from "../types";

export const FOOTBALL_DATA_BASE_URL = "https://api.football-data.org/v4";
const MAX_BODY_CHARS = 5_000_000;

export interface FootballDataClientOptions {
  token: string;
  baseUrl?: string;
  /** Таймаут одного запроса; должен быть заметно короче бюджета задания (docs/requirements.md §10.8). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Секунды ожидания после 429: Retry-After (секунды или HTTP-дата), иначе
 * X-RequestCounter-Reset (секунды до сброса счетчика football-data). null — неизвестно.
 */
export function parseRetryAfter(headers: Headers, now: Date = new Date()): number | null {
  const retryAfter = headers.get("retry-after")?.trim();
  if (retryAfter) {
    if (/^\d+$/.test(retryAfter)) return Number(retryAfter);
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - now.getTime()) / 1000));
  }
  const reset = headers.get("x-requestcounter-reset")?.trim();
  if (reset && /^\d+$/.test(reset)) return Number(reset);
  return null;
}

export class FootballDataClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FootballDataClientOptions) {
    if (!options.token) throw new Error("FootballDataClient: токен не задан");
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? FOOTBALL_DATA_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** GET JSON. Токен передается только в заголовке и не попадает в сообщения об ошибках. */
  async getJson(path: string): Promise<unknown> {
    if (!path.startsWith("/") || path.startsWith("//")) {
      throw new Error("FootballDataClient: ожидается относительный путь");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: "GET",
          headers: { "X-Auth-Token": this.token, Accept: "application/json" },
          signal: controller.signal,
          cache: "no-store",
        });
      } catch {
        throw controller.signal.aborted
          ? new ProviderError("TIMEOUT", "football-data: таймаут запроса")
          : new ProviderError("NETWORK", "football-data: сетевая ошибка");
      }

      if (response.status === 429) {
        throw new ProviderError("RATE_LIMITED", "football-data: превышен лимит запросов", {
          httpStatus: 429,
          retryAfterSeconds: parseRetryAfter(response.headers),
        });
      }
      if (response.status === 401) {
        throw new ProviderError("UNAUTHORIZED", "football-data: токен отклонен", {
          httpStatus: 401,
        });
      }
      if (response.status === 403) {
        throw new ProviderError("FORBIDDEN", "football-data: ресурс недоступен на тарифе", {
          httpStatus: 403,
        });
      }
      if (!response.ok) {
        throw new ProviderError("HTTP", `football-data: HTTP ${response.status}`, {
          httpStatus: response.status,
        });
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        throw controller.signal.aborted
          ? new ProviderError("TIMEOUT", "football-data: таймаут чтения ответа")
          : new ProviderError("NETWORK", "football-data: обрыв ответа");
      }
      if (text.length > MAX_BODY_CHARS) {
        throw new ProviderError("INVALID_RESPONSE", "football-data: слишком большой ответ");
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new ProviderError("INVALID_RESPONSE", "football-data: ответ не JSON");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}
