import "server-only";
import type { ServerSupabase } from "@/server/db/supabase-server";
import { placeBetResultSchema, type BetCommand, type PlaceBetResult } from "./contract";

/**
 * Вызов place_bet от имени пользователя (auth.uid() в БД). Клиентские userId, odds, payout и баланс
 * не передаются вообще — их берет БД.
 */
export async function placeBet(
  supabase: ServerSupabase,
  command: BetCommand,
): Promise<PlaceBetResult> {
  const { data, error } = await supabase.rpc("place_bet", {
    p_market_id: command.marketId,
    p_outcome: command.outcome,
    p_stake: command.stake,
    p_quote_version: command.quoteVersion,
    p_idempotency_key: command.idempotencyKey,
  });
  if (error) throw new Error(`place_bet failed: ${error.code ?? "unknown"}`);
  return placeBetResultSchema.parse(data);
}
