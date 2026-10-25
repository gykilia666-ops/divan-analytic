import { NextResponse } from "next/server";

// Публичный health минимален (CLAUDE.md §11.3): без инфраструктуры и без внешних вызовов.
export const dynamic = "force-dynamic";

export function GET() {
  const requestId = crypto.randomUUID();
  return NextResponse.json(
    { data: { status: "ok" }, meta: { requestId } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
