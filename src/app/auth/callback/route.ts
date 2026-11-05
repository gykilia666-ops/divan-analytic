import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_COOKIE, NEXT_COOKIE } from "@/lib/auth-constants";
import { parseConsentCookie } from "@/lib/consent";
import { getEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { recordConsents } from "@/server/account/consents";
import { AccountDisabledError } from "@/server/auth/errors";
import { createClient } from "@/server/db/supabase-server";
import { logEvent } from "@/server/observability/log";

/**
 * Возврат из GitHub: обмен кода на сессию и запись согласий. Профиль и кошелек здесь НЕ создаются: они
 * появляются только при выборе псевдонима (ADR-075).
 * Без cookie с согласиями сессия не создается: прийти сюда в обход формы входа нельзя (ADR-065).
 */
export async function GET(request: NextRequest) {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected" || !env.APP_ORIGIN) {
    return new NextResponse(null, { status: 404 });
  }
  const origin = env.APP_ORIGIN;
  const toLogin = (code: string) =>
    NextResponse.redirect(new URL(`/login?error=${code}`, origin), 303);

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return toLogin("denied");
  const code = params.get("code");
  if (!code) return toLogin("oauth");

  const cookieStore = await cookies();
  const next = safeNextPath(cookieStore.get(NEXT_COOKIE)?.value);
  const consented = parseConsentCookie(cookieStore.get(CONSENT_COOKIE)?.value);
  cookieStore.set(NEXT_COOKIE, "", { path: "/auth", maxAge: 0 });
  cookieStore.set(CONSENT_COOKIE, "", { path: "/auth", maxAge: 0 });
  if (!consented) return toLogin("consent");

  const supabase = await createClient();
  const { data: session, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logEvent({
      event: "auth.callback_exchange_failed",
      level: "error",
      errorCode: error.code ?? String(error.status ?? "unknown"),
    });
    return toLogin("oauth");
  }

  try {
    await recordConsents(supabase);
  } catch (e) {
    const disabled = e instanceof AccountDisabledError;
    // Причина нужна в журнале: пользователю показывается только общее «не удалось подготовить аккаунт».
    if (!disabled) {
      logEvent({
        event: "auth.callback_consent_failed",
        level: "error",
        errorCode: e instanceof Error ? e.message : "unknown",
      });
    }
    await supabase.auth.signOut({ scope: "local" });
    return toLogin(disabled ? "disabled" : "init");
  }

  // Псевдоним выбирает сам пользователь (ADR-072): пока имени нет, ведем на страницу выбора.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.user.id)
    .maybeSingle();
  const needsPseudonym = !profileError && (!profile || typeof profile.display_name !== "string");
  if (needsPseudonym) {
    return NextResponse.redirect(
      new URL(`/my/pseudonym?next=${encodeURIComponent(next)}`, origin),
      303,
    );
  }

  return NextResponse.redirect(new URL(next, origin), 303);
}
