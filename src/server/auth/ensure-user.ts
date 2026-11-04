import "server-only";
import { z } from "zod";
import type { ServerSupabase } from "@/server/db/supabase-server";

export class AccountDisabledError extends Error {
  constructor() {
    super("ACCOUNT_DISABLED");
    this.name = "AccountDisabledError";
  }
}

const rowSchema = z.object({
  wallet_balance: z.union([z.number(), z.string()]).transform(Number),
  credited: z.boolean(),
});

/**
 * Идемпотентная инициализация профиля, кошелька и стартового кредита (RPC ensure_user_initialized).
 * Безопасно вызывать повторно и конкурентно: начисление происходит один раз.
 */
export async function ensureUserInitialized(
  supabase: ServerSupabase,
): Promise<{ balance: number; credited: boolean }> {
  const { data, error } = await supabase.rpc("ensure_user_initialized");
  if (error) {
    if (error.message.includes("ACCOUNT_DISABLED")) throw new AccountDisabledError();
    throw new Error(`ensure_user_initialized failed: ${error.code ?? "unknown"}`);
  }
  const rows = z.array(rowSchema).min(1).parse(data);
  const row = rows[0];
  if (!row) throw new Error("ensure_user_initialized returned no rows");
  return { balance: row.wallet_balance, credited: row.credited };
}
