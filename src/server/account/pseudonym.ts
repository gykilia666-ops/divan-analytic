import "server-only";
import { z } from "zod";
import type { PseudonymErrorCode } from "@/lib/pseudonym";
import type { ServerSupabase } from "@/server/db/supabase-server";

export type SetPseudonymResult =
  { ok: true; displayName: string } | { ok: false; code: PseudonymErrorCode };

const resultSchema = z.union([
  z.object({ ok: z.literal(true), displayName: z.string() }),
  z.object({
    ok: z.literal(false),
    code: z.enum([
      "INVALID_NAME",
      "RESERVED_NAME",
      "MATCHES_ACCOUNT",
      "NAME_TAKEN",
      "RATE_LIMITED",
      "ACCOUNT_NOT_FOUND",
      "ACCOUNT_DISABLED",
      "ALREADY_SET",
    ]),
  }),
]);

/**
 * Однократный выбор псевдонима (RPC set_pseudonym, ADR-073). Все проверки — в БД; прямой UPDATE
 * display_name клиентским ролям запрещен, повторный выбор дает ALREADY_SET. Сбой БД — исключение
 * (вызывающий отвечает 503).
 */
export async function setPseudonym(
  supabase: ServerSupabase,
  name: string,
): Promise<SetPseudonymResult> {
  const { data, error } = await supabase.rpc("set_pseudonym", { p_name: name });
  if (error) throw new Error(`set_pseudonym failed: ${error.code ?? "unknown"}`);
  return resultSchema.parse(data);
}
