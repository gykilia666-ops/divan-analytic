import type { NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/origin";
import { checkPseudonym, PSEUDONYM_ERROR_MESSAGES, type PseudonymErrorCode } from "@/lib/pseudonym";
import { setPseudonym } from "@/server/account/pseudonym";
import { getCurrentUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonOk } from "@/server/http/response";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ name: z.string().max(200) });

const STATUS: Record<PseudonymErrorCode, number> = {
  INVALID_NAME: 422,
  RESERVED_NAME: 422,
  MATCHES_ACCOUNT: 422,
  NAME_TAKEN: 409,
  RATE_LIMITED: 429,
  ACCOUNT_NOT_FOUND: 409,
  ACCOUNT_DISABLED: 403,
  ALREADY_SET: 409,
};

/** Выбрать псевдоним (один раз, ADR-073). Имя не придумывается за пользователя (ADR-072). */
export async function POST(request: NextRequest) {
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
    if (text.length > 512) throw new Error("too large");
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Некорректный запрос", requestId);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return jsonError(400, "VALIDATION_ERROR", "Некорректный запрос", requestId);

  const check = checkPseudonym(parsed.data.name);
  if (!check.ok) return jsonError(422, "INVALID_NAME", check.message, requestId);

  try {
    const supabase = await createClient();
    const result = await setPseudonym(supabase, check.name);
    if (!result.ok) {
      return jsonError(
        STATUS[result.code],
        result.code,
        PSEUDONYM_ERROR_MESSAGES[result.code],
        requestId,
      );
    }
    return jsonOk({ displayName: result.displayName }, requestId);
  } catch {
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
