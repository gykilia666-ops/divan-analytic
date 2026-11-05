import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getSupabaseConfig } from "@/lib/supabase-config";

/** Заголовки запроса для серверных компонентов: исходные (с актуальными cookie) + добавленные. */
function forwardHeaders(request: NextRequest, extra: Record<string, string>): Headers {
  const headers = new Headers(request.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return headers;
}

/**
 * Обновление сессии в proxy.ts. Вызов getClaims() проверяет подпись токена и при необходимости
 * обновляет его; новые cookie передаются и серверным компонентам, и браузеру.
 * В режиме demo авторизации нет — запрос проходит без изменений (кроме extraRequestHeaders).
 */
export async function updateSession(
  request: NextRequest,
  extraRequestHeaders: Record<string, string> = {},
): Promise<NextResponse> {
  const env = getEnv();
  const next = () =>
    NextResponse.next({ request: { headers: forwardHeaders(request, extraRequestHeaders) } });
  if (env.APP_DATA_MODE !== "connected") return next();

  const { url, publishableKey } = getSupabaseConfig(env);
  let supabaseResponse = next();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = next();
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers ?? {})) {
          supabaseResponse.headers.set(key, value);
        }
      },
    },
  });

  await supabase.auth.getClaims();
  return supabaseResponse;
}
