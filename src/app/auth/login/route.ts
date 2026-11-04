import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { NEXT_COOKIE } from "@/lib/auth-constants";
import { getEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/origin";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/server/db/supabase-server";
import { jsonError } from "@/server/http/response";

/** Запуск GitHub OAuth. POST (а не GET), чтобы сторонняя страница не могла инициировать вход. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected" || !env.APP_ORIGIN) {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Вход недоступен в демо-режиме", requestId);
  }
  if (!isAllowedOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }

  const form = await request.formData();
  const rawNext = form.get("next");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: new URL("/auth/callback", env.APP_ORIGIN).toString() },
  });
  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?error=oauth", env.APP_ORIGIN), 303);
  }

  // Адрес возврата — в короткоживущей httpOnly-cookie, а не в URL: его нельзя подменить ссылкой.
  const cookieStore = await cookies();
  cookieStore.set(NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.APP_ORIGIN.startsWith("https://"),
    path: "/auth",
    maxAge: 600,
  });

  return NextResponse.redirect(data.url, 303);
}
