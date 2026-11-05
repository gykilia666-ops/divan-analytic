import { NextResponse } from "next/server";

/** Контракты ответов API (CLAUDE.md §11.2). Приватные ответы никогда не кешируются. */
const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonOk<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json({ data, meta: { requestId } }, { status, headers: NO_STORE });
}

/** Публичные данные: общий кеш (CLAUDE.md §14.3: матчи — 30 секунд, рейтинг — 60). */
export function jsonPublic<T>(
  data: T,
  meta: Record<string, unknown>,
  requestId: string,
  maxAgeSeconds = 30,
) {
  return NextResponse.json(
    { data, meta: { requestId, ...meta } },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`,
      },
    },
  );
}

export function jsonError(status: number, code: string, message: string, requestId: string) {
  return NextResponse.json({ error: { code, message, requestId } }, { status, headers: NO_STORE });
}
