import type { NextRequest } from "next/server";
import { isAllowedOrigin } from "@/lib/origin";
import { AdminForbiddenError, resolveConflict, resolveConflictSchema } from "@/server/admin";
import { guardAdmin } from "@/server/admin/guard";
import { jsonError, jsonOk } from "@/server/http/response";
import { logEvent } from "@/server/observability/log";

export const dynamic = "force-dynamic";

/** Снять паузу конфликта результата, приняв наблюдаемый итог (§9.5). Только администратор. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const guard = await guardAdmin(requestId);
  if (!guard.ok) return guard.response;
  if (!isAllowedOrigin(request.headers.get("origin"), guard.env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 2048) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Некорректный запрос", requestId);
  }
  const parsed = resolveConflictSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Укажите причину (от 5 символов)", requestId);
  }
  try {
    if (!(await resolveConflict(guard.supabase, parsed.data))) {
      return jsonError(409, "NO_CONFLICT", "Конфликт уже снят", requestId);
    }
    logEvent({ event: "admin.conflict_resolved", requestId });
    return jsonOk({ resolved: true }, requestId);
  } catch (error) {
    if (error instanceof AdminForbiddenError) {
      return jsonError(403, "FORBIDDEN", "Недостаточно прав", requestId);
    }
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
