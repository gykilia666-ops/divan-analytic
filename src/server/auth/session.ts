import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createClient } from "@/server/db/supabase-server";

export interface CurrentUser {
  id: string;
}

export interface CurrentProfile {
  id: string;
  /** null — псевдоним еще не выбран (ADR-072). */
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Пользователь по ПРОВЕРЕННЫМ claims (getClaims проверяет подпись токена). getSession() для
 * решений об доступе не используется. В режиме demo сессий нет.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (getEnv().APP_DATA_MODE !== "connected") return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || sub.length === 0) return null;
  return { id: sub };
});

/** Для защищенных страниц: без сессии — на /login с возвратом. */
export async function requireUser(returnTo: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

/**
 * Для личных страниц: нужны вход и выбранный псевдоним. Без псевдонима — на страницу его выбора
 * (ADR-072: имя придумывает сам пользователь), с возвратом на исходную страницу.
 */
export async function requirePseudonym(returnTo: string): Promise<CurrentProfile> {
  await requireUser(returnTo);
  const profile = await getCurrentProfile();
  // Профиля нет, пока псевдоним не выбран (ADR-075): это тот же путь, что и «имя не выбрано».
  if (!profile || !profile.displayName) {
    redirect(`/my/pseudonym?next=${encodeURIComponent(returnTo)}`);
  }
  return profile;
}

const profileSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

/** Профиль по RLS (виден только свой). null — нет сессии, профиль еще не создан или аккаунт удален. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`profile query failed: ${error.code ?? "unknown"}`);
  if (!data) return null;
  const row = profileSchema.parse(data);
  return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url };
});
