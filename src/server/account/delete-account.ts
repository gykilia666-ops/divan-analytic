import "server-only";
import { z } from "zod";
import type { AdminSupabase } from "@/server/db/supabase-admin";
import type { ServerSupabase } from "@/server/db/supabase-server";

export type DeleteAccountResult =
  | { ok: true; alreadyDeleted: boolean }
  | { ok: false; code: "ACCOUNT_NOT_FOUND" | "AUTH_DELETE_FAILED" };

const dbResultSchema = z.union([
  z.object({ ok: z.literal(true), alreadyDeleted: z.boolean() }),
  z.object({ ok: z.literal(false), code: z.literal("ACCOUNT_NOT_FOUND") }),
]);

/**
 * Удаление аккаунта (ADR-061): 1) БД обезличивает и отключает профиль от имени пользователя (RLS, auth.uid());
 * 2) сервер мягко удаляет учетную запись Supabase Auth — вход по ней больше невозможен.
 * Порядок важен: если шаг 2 не удался, профиль уже отключен, а повтор безопасен (оба шага идемпотентны).
 */
export async function deleteAccount(
  userClient: ServerSupabase,
  admin: AdminSupabase,
  userId: string,
): Promise<DeleteAccountResult> {
  const { data, error } = await userClient.rpc("delete_my_account");
  if (error) throw new Error(`delete_my_account failed: ${error.code ?? "unknown"}`);
  const result = dbResultSchema.parse(data);
  if (!result.ok) return result;

  const authResult = await admin.auth.admin.deleteUser(userId, true);
  if (authResult.error) return { ok: false, code: "AUTH_DELETE_FAILED" };
  return result;
}
