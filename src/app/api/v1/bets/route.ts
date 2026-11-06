import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { isAllowedOrigin } from "@/lib/origin";
import { getCurrentUser } from "@/server/auth/session";
import { betCommandSchema, errorResponseFor, MAX_BODY_BYTES } from "@/server/betting/contract";
import { placeBet } from "@/server/betting/place-bet";
import { createClient } from "@/server/db/supabase-server";
import { jsonError, jsonOk } from "@/server/http/response";
import { logEvent } from "@/server/observability/log";

export const dynamic = "force-dynamic";

/** Прием прогноза (docs/requirements.md §6.7, §11). Решение принимает place_bet в БД. */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const env = getEnv();

  if (env.APP_DATA_MODE !== "connected") {
    return jsonError(
      503,
      "SERVICE_UNAVAILABLE",
      "В демо-режиме прогнозы не принимаются",
      requestId,
    );
  }
  if (!isAllowedOrigin(request.headers.get("origin"), env.APP_ORIGIN)) {
    return jsonError(403, "FORBIDDEN", "Запрос отклонен", requestId);
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return jsonError(400, "VALIDATION_ERROR", "Ожидается JSON", requestId);
  }

  const user = await getCurrentUser();
  if (!user) return jsonError(401, "UNAUTHENTICATED", "Требуется вход", requestId);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return jsonError(400, "VALIDATION_ERROR", "Слишком большой запрос", requestId);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonError(400, "VALIDATION_ERROR", "Некорректный JSON", requestId);
  }
  const parsed = betCommandSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "VALIDATION_ERROR", "Проверьте исход и сумму", requestId);
  }

  try {
    const result = await placeBet(await createClient(), parsed.data);
    if (!result.ok) {
      const err = errorResponseFor(result.code);
      logEvent({ event: "bet.rejected", level: "info", requestId, errorCode: err.code });
      return jsonError(err.status, err.code, err.message, requestId);
    }
    logEvent({ event: result.replay ? "bet.replayed" : "bet.placed", requestId });
    return jsonOk(
      { bet: result.bet, balance: result.balance, replay: result.replay },
      requestId,
      result.replay ? 200 : 201,
    );
  } catch (error) {
    logEvent({
      event: "bet.failed",
      level: "error",
      requestId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return jsonError(503, "SERVICE_UNAVAILABLE", "Сервис временно недоступен", requestId);
  }
}
