import "server-only";
import { cache } from "react";
import { getEnv } from "@/lib/env";
import { createClient } from "@/server/db/supabase-server";
import { getDbCatalog, getDbMatch } from "./db-catalog";
import { getDemoCatalog, getDemoMatch } from "./demo-catalog";
import type { CatalogMatch, CatalogPage, CatalogQuery } from "./types";

/** Единый вход для страниц и API: в demo — fixtures, в connected — БД (без дублирования логики). */
export async function getCatalog(query: CatalogQuery): Promise<CatalogPage> {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") return getDemoCatalog(query);
  return getDbCatalog(await createClient(), env.SPORTS_PROVIDER, query);
}

/** Кешируется в пределах одного запроса: layout и страница матча делят одно чтение. */
export const getMatch = cache(async (id: string): Promise<CatalogMatch | null> => {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") return getDemoMatch(id);
  return getDbMatch(await createClient(), env.SPORTS_PROVIDER, id);
});

export type CatalogResult<T> = { ok: true; value: T } | { ok: false };

/** Загрузка без исключений: страницы показывают состояние ошибки, а не падают целиком. */
export async function loadSafely<T>(load: () => Promise<T>): Promise<CatalogResult<T>> {
  try {
    return { ok: true, value: await load() };
  } catch {
    return { ok: false };
  }
}
