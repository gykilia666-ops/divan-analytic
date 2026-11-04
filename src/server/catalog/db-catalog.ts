import "server-only";
import { z } from "zod";
import { zonedDayToUtcRange } from "@/lib/day-range";
import type { ServerSupabase } from "@/server/db/supabase-server";
import { catalogRowSchema, iso, rowToCatalog } from "./catalog-row";
import { decodeCursor, encodeCursor } from "./cursor";
import type { CatalogMatch, CatalogPage, CatalogQuery } from "./types";

/** Каталог из БД от имени текущего пользователя/гостя (RLS действует). */
export async function getDbCatalog(
  supabase: ServerSupabase,
  provider: string,
  query: CatalogQuery,
): Promise<CatalogPage> {
  const range = query.date ? zonedDayToUtcRange(query.date, query.timeZone) : null;
  const cursor = decodeCursor(query.cursor);

  const [list, competitions] = await Promise.all([
    supabase.rpc("list_matches", {
      p_provider: provider,
      p_competition: query.competition,
      p_from: range?.from ?? null,
      p_to: range?.to ?? null,
      p_scope: query.scope,
      p_after_kickoff: cursor?.kickoffAt ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: query.limit,
    }),
    supabase
      .from("competitions")
      .select("code, name")
      .eq("provider", provider)
      .eq("enabled", true)
      .order("code"),
  ]);
  if (list.error) throw new Error(`list_matches failed: ${list.error.code ?? "unknown"}`);
  if (competitions.error)
    throw new Error(`competitions failed: ${competitions.error.code ?? "unknown"}`);

  const rows = z.array(catalogRowSchema).parse(list.data);
  const pageRows = rows.slice(0, query.limit);
  const items = pageRows.map(rowToCatalog);
  const last = items[items.length - 1];
  const seen = items
    .map((m) => m.lastSeenAt)
    .filter((v): v is string => v !== null)
    .sort();

  return {
    items,
    nextCursor:
      rows.length > query.limit && last
        ? encodeCursor({ kickoffAt: last.kickoffAt, id: last.id })
        : null,
    competitions: z
      .array(z.object({ code: z.string(), name: z.string() }))
      .parse(competitions.data),
    now: rows[0] ? iso(rows[0].db_now) : new Date().toISOString(),
    lastSyncedAt: seen[seen.length - 1] ?? null,
    source: "database",
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getDbMatch(
  supabase: ServerSupabase,
  provider: string,
  id: string,
): Promise<CatalogMatch | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await supabase
    .from("match_catalog")
    .select("*")
    .eq("id", id)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`match_catalog failed: ${error.code ?? "unknown"}`);
  return data ? rowToCatalog(catalogRowSchema.parse(data)) : null;
}
