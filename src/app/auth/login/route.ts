import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_COOKIE, NEXT_COOKIE } from "@/lib/auth-constants";
import { serializeConsentCookie } from "@/lib/consent";
import { getEnv } from "@/lib/env";
import { getOperator } from "@/lib/legal";
import { isAllowedOrigin } from "@/lib/origin";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/server/db/supabase-server";
import { jsonError } from "@/server/http/response";

/**
 * Запуск GitHub OAuth. POST (а не GET), чтобы сторонняя страница не могла инициировать вход.
 * До перехода к GitHub сервер проверяет данные оператора и фиксирует согласие нажатием (ADR-065/066/077):
 * персональные данные нельзя собирать без согласия и без указания оператора.
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected" || !env.APP_ORIGIN) {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Вход недоступен в демо-режиме", requestId);
  }
  if (!isAllowedOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }
  if (!getOperator().complete) {
    return jsonError(
      503,
      "SERVICE_UNAVAILABLE",
      "Вход временно недоступен: не указаны данные оператора сайта",
      requestId,
    );
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

  // Адрес возврата и факт согласий — в коротких httpOnly-cookie, а не в URL: их нельзя подменить ссылкой.
  const cookieStore = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.APP_ORIGIN.startsWith("https://"),
    path: "/auth",
    maxAge: 600,
  };
  cookieStore.set(NEXT_COOKIE, next, options);
  cookieStore.set(CONSENT_COOKIE, serializeConsentCookie(), options);

  return NextResponse.redirect(data.url, 303);
}
