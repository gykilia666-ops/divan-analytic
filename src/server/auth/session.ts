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
  displayName: string;
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

const profileSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  avatar_url: z.string().nullable(),
});

/** Профиль по RLS (виден только свой). null — нет сессии или профиль еще не создан. */
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(`profile query failed: ${error.code ?? "unknown"}`);
  if (!data) return null;
  const row = profileSchema.parse(data);
  return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url };
});
