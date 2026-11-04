import type { NextRequest } from "next/server";
import { getCatalog } from "@/server/catalog";
import { parseCatalogQuery } from "@/server/catalog/parse-query";
import { jsonError, jsonPublic } from "@/server/http/response";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const query = parseCatalogQuery(Object.fromEntries(request.nextUrl.searchParams));
  try {
    const page = await getCatalog(query);
    return jsonPublic(
      { items: page.items, nextCursor: page.nextCursor, competitions: page.competitions },
      { lastSyncedAt: page.lastSyncedAt, now: page.now, source: page.source },
      requestId,
    );
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Каталог временно недоступен", requestId);
  }
}
