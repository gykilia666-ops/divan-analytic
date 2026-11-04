import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Привилегированный клиент (secret / service-role key) только для серверных заданий.
 * Обходит RLS — поэтому не используется в коде, который обрабатывает запросы пользователей.
 */
export function createAdminClient() {
  const env = getEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin не настроен");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminSupabase = ReturnType<typeof createAdminClient>;
