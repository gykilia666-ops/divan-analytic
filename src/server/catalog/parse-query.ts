import { isValidYmd } from "@/lib/day-range";
import { isValidTimeZone } from "@/lib/time";
import { decodeCursor } from "./cursor";
import { CATALOG_SCOPES, type CatalogQuery, type CatalogScope } from "./types";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === undefined || v.trim() === "" ? null : v.trim();
}

/**
 * Параметры каталога из строки запроса. Некорректные значения не ломают страницу,
 * а заменяются безопасными значениями по умолчанию.
 */
export function parseCatalogQuery(params: Params): CatalogQuery {
  const competition = first(params.competition);
  const date = first(params.date);
  const tz = first(params.tz);
  const scope = first(params.scope);
  const cursor = first(params.cursor);
  const limitRaw = first(params.limit);

  const limitNum = limitRaw && /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT;

  return {
    competition: competition && /^[A-Z0-9]{2,5}$/.test(competition) ? competition : null,
    date: date && isValidYmd(date) ? date : null,
    timeZone: tz && tz.length <= 64 && isValidTimeZone(tz) ? tz : "UTC",
    scope: CATALOG_SCOPES.includes(scope as CatalogScope) ? (scope as CatalogScope) : "all",
    cursor: cursor && decodeCursor(cursor) ? cursor : null,
    limit: Math.min(Math.max(limitNum, 1), MAX_LIMIT),
  };
}

/** Строка запроса для ссылок (без пустых значений). */
export function catalogSearch(query: CatalogQuery, overrides: Partial<CatalogQuery> = {}): string {
  const q = { ...query, ...overrides };
  const params = new URLSearchParams();
  if (q.competition) params.set("competition", q.competition);
  if (q.date) params.set("date", q.date);
  if (q.timeZone !== "UTC") params.set("tz", q.timeZone);
  if (q.scope !== "all") params.set("scope", q.scope);
  if (q.cursor) params.set("cursor", q.cursor);
  if (q.limit !== DEFAULT_LIMIT) params.set("limit", String(q.limit));
  const s = params.toString();
  return s ? `?${s}` : "";
}
