import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";
import { getSupabaseConfig } from "@/lib/supabase-config";

/**
 * Supabase-клиент от имени пользователя (publishable key + cookie-сессия). RLS действует.
 * Service-role здесь не используется: привилегированные операции изолируются отдельно (этапы 7+).
 */
export async function createClient() {
  const { url, publishableKey } = getSupabaseConfig(getEnv());
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Вызов из Server Component: cookie писать нельзя. Сессию обновит proxy.ts.
        }
      },
    },
  });
}

export type ServerSupabase = Awaited<ReturnType<typeof createClient>>;
