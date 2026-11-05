import "server-only";
import { z } from "zod";
import { LEGAL_VERSION } from "@/lib/legal-version";
import { AccountDisabledError } from "@/server/auth/errors";
import type { ServerSupabase } from "@/server/db/supabase-server";

export type ConsentKind = "TERMS_AND_AGE" | "PD_PROCESSING";

export interface ConsentRow {
  kind: ConsentKind;
  docVersion: string;
  granted: boolean;
  createdAt: string;
}

const resultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), code: z.string() }),
]);

const rowSchema = z.object({
  kind: z.enum(["TERMS_AND_AGE", "PD_PROCESSING"]),
  doc_version: z.string(),
  granted: z.boolean(),
  created_at: z.string(),
});

/**
 * Запись согласий при входе (RPC record_consents): журнал только добавляется, повтор той же версии
 * ничего не пишет. Вызывается из auth-callback сразу после входа: профиля тогда еще нет, он создается при выборе псевдонима (ADR-075).
 */
export async function recordConsents(supabase: ServerSupabase): Promise<void> {
  const { data, error } = await supabase.rpc("record_consents", { p_version: LEGAL_VERSION });
  if (error) {
    if (error.message.includes("ACCOUNT_DISABLED")) throw new AccountDisabledError();
    throw new Error(`record_consents failed: ${error.code ?? "unknown"}`);
  }
  const result = resultSchema.parse(data);
  if (!result.ok) throw new Error(`record_consents rejected: ${result.code}`);
}

/** Последнее состояние каждого вида согласия текущего пользователя (по RLS). */
export async function getMyConsents(supabase: ServerSupabase): Promise<ConsentRow[]> {
  const { data, error } = await supabase.rpc("my_consents");
  if (error) throw new Error(`my_consents failed: ${error.code ?? "unknown"}`);
  return z
    .array(rowSchema)
    .parse(data ?? [])
    .map((row) => ({
      kind: row.kind,
      docVersion: row.doc_version,
      granted: row.granted,
      createdAt: row.created_at,
    }));
}
