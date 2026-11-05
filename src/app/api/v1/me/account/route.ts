import type { NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/origin";
import { deleteAccount } from "@/server/account/delete-account";
import { getCurrentProfile, getCurrentUser } from "@/server/auth/session";
import { createAdminClient } from "@/server/db/supabase-admin";
import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonOk } from "@/server/http/response";
import { logEvent } from "@/server/observability/log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ confirm: z.string().max(100) });

/** Удаление своего аккаунта. Подтверждение — точное имя пользователя (защита от случайного нажатия). */
export async function DELETE(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") {
    return jsonError(404, "NOT_FOUND", "Не найдено", requestId);
  }
  if (!isAllowedOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }
  const user = await getCurrentUser();
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Некорректный запрос", requestId);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Некорректный запрос", requestId);
  }

  try {
    const profile = await getCurrentProfile();
    if (!profile) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);
    if (parsed.data.confirm.trim() !== profile.displayName) {
      return jsonError(
        400,
        "CONFIRMATION_MISMATCH",
        "Имя для подтверждения не совпадает",
        requestId,
      );
    }

    const supabase = await createClient();
    const result = await deleteAccount(supabase, createAdminClient(), user.id);
    if (!result.ok) {
      logEvent({
        event: "account.delete_failed",
        level: "error",
        requestId,
        errorCode: result.code,
      });
      return jsonError(
        503,
        "SERVICE_UNAVAILABLE",
        "Не удалось удалить аккаунт, повторите",
        requestId,
      );
    }
    await supabase.auth.signOut({ scope: "local" });
    logEvent({ event: "account.deleted", requestId });
    return jsonOk({ deleted: true }, requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
