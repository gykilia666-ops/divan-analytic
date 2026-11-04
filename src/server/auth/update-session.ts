import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { getSupabaseConfig } from "@/lib/supabase-config";

/**
 * Обновление сессии в proxy.ts. Вызов getClaims() проверяет подпись токена и при необходимости
 * обновляет его; новые cookie передаются и серверным компонентам, и браузеру.
 * В режиме demo авторизации нет — запрос проходит без изменений.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") return NextResponse.next({ request });

  const { url, publishableKey } = getSupabaseConfig(env);
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers?: Record<string, string>) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        supabaseResponse = NextResponse.next({ request });
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
