import { z } from "zod";

/** Команда клиента (CLAUDE.md §6.7). Лишние поля (userId, odds, payout…) отклоняются. */
export const betCommandSchema = z
  .object({
    marketId: z.string().uuid(),
    outcome: z.enum(["HOME", "DRAW", "AWAY"]),
    stake: z.number().int().min(10).max(1000),
    quoteVersion: z.number().int().min(1),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type BetCommand = z.infer<typeof betCommandSchema>;

export const placedBetSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  outcome: z.enum(["HOME", "DRAW", "AWAY"]),
  stake: z.number().int(),
  acceptedOddsMilli: z.number().int(),
  potentialPayout: z.number().int(),
  status: z.enum(["PENDING", "WON", "LOST", "VOID"]),
  createdAt: z.string(),
});
export type PlacedBet = z.infer<typeof placedBetSchema>;

export const placeBetResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    replay: z.boolean(),
    balance: z.number().int().nullable(),
    bet: placedBetSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type PlaceBetResult = z.infer<typeof placeBetResultSchema>;

/** Код отказа place_bet → HTTP-статус и понятное сообщение (CLAUDE.md §11.2). */
const ERRORS: Record<string, { status: number; message: string }> = {
  UNAUTHENTICATED: { status: 401, message: "Требуется вход" },
  VALIDATION_ERROR: { status: 400, message: "Проверьте исход и сумму" },
  ACCOUNT_DISABLED: { status: 403, message: "Аккаунт отключен" },
  ACCOUNT_NOT_READY: { status: 409, message: "Аккаунт еще не подготовлен. Войдите заново" },
  NOT_FOUND: { status: 404, message: "Рынок не найден" },
  MARKET_CLOSED: { status: 409, message: "Прием прогнозов на этот матч закрыт" },
  DATA_STALE: { status: 503, message: "Данные матча устарели, прием временно закрыт" },
  QUOTE_CHANGED: { status: 409, message: "Коэффициенты изменились. Проверьте и подтвердите снова" },
  ALREADY_PLACED: { status: 409, message: "Прогноз на этот матч уже сделан" },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    message: "Этот запрос уже был отправлен с другими данными",
  },
  INSUFFICIENT_BALANCE: { status: 422, message: "Недостаточно монет" },
  RATE_LIMITED: { status: 429, message: "Слишком много попыток. Подождите минуту" },
};

export function errorResponseFor(code: string): { status: number; code: string; message: string } {
  const known = ERRORS[code];
  return known
    ? { status: known.status, code, message: known.message }
    : { status: 503, code: "SERVICE_UNAVAILABLE", message: "Сервис временно недоступен" };
}

export const MAX_BODY_BYTES = 2048;
