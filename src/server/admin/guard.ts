import "server-only";
import type { NextResponse } from "next/server";
import { getEnv, type AppEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { createClient, type ServerSupabase } from "@/server/db/supabase-server";
import { jsonError } from "@/server/http/response";
import { isCurrentUserAdmin } from "./index";

type Guarded =
  | { ok: true; env: AppEnv; supabase: ServerSupabase; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Серверная проверка роли для admin API (CLAUDE.md §12, §13.1): demo → 404, гость → 401,
 * не администратор → 403. Роль проверяется в БД при каждом запросе, без кеша.
 */
export async function guardAdmin(requestId: string): Promise<Guarded> {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") {
    return { ok: false, response: jsonError(404, "NOT_FOUND", "Не найдено", requestId) };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, response: jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId) };
  }
  try {
    const supabase = await createClient();
    if (!(await isCurrentUserAdmin(supabase))) {
      return { ok: false, response: jsonError(403, "FORBIDDEN", "Недостаточно прав", requestId) };
    }
    return { ok: true, env, supabase, userId: user.id };
  } catch {
    return {
      ok: false,
      response: jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId),
    };
  }
}
