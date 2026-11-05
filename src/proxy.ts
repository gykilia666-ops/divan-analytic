import type { NextRequest } from "next/server";
import { buildCsp, createNonce } from "@/lib/csp";
import { getEnv } from "@/lib/env";
import { updateSession } from "@/server/auth/update-session";

// Next.js 16: файл proxy.ts заменил middleware.ts. Это НЕ единственная авторизация:
// страницы и API проверяют пользователя сами (src/server/auth/session.ts).
// Здесь же — CSP с nonce на каждый запрос: Next.js читает nonce из заголовка запроса и ставит его
// своим скриптам (поэтому страницы рендерятся динамически, см. RootLayout).
export async function proxy(request: NextRequest) {
  const env = getEnv();
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: env.APP_DATA_MODE === "connected" ? (env.NEXT_PUBLIC_SUPABASE_URL ?? null) : null,
    https: (env.APP_ORIGIN ?? "").startsWith("https://"),
  });

  const response = await updateSession(request, {
    "x-nonce": nonce,
    "content-security-policy": csp,
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
