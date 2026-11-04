import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/origin";
import { createClient } from "@/server/db/supabase-server";
import { jsonError } from "@/server/http/response";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected" || !env.APP_ORIGIN) {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Вход недоступен в демо-режиме", requestId);
  }
  if (!isAllowedOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }

  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.redirect(new URL("/", env.APP_ORIGIN), 303);
}
