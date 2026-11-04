import "server-only";
import type { ServerSupabase } from "@/server/db/supabase-server";

/** Баланс текущего пользователя по RLS; null — кошелька нет или ошибка чтения. */
export async function getMyBalance(
  supabase: ServerSupabase,
  userId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data || typeof data.balance !== "number") return null;
  return data.balance;
}

/** Есть ли у пользователя прогноз на рынок (для страницы матча). */
export async function getMyBetForMarket(
  supabase: ServerSupabase,
  marketId: string,
): Promise<{ id: string; outcome: string; stake: number; potentialPayout: number } | null> {
  const { data, error } = await supabase
    .from("bets")
    .select("id, outcome, stake, potential_payout")
    .eq("market_id", marketId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    outcome: String(data.outcome),
    stake: Number(data.stake),
    potentialPayout: Number(data.potential_payout),
  };
}
