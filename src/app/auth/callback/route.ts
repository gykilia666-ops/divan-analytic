import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { NEXT_COOKIE } from "@/lib/auth-constants";
import { getEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";
import { AccountDisabledError, ensureUserInitialized } from "@/server/auth/ensure-user";
import { createClient } from "@/server/db/supabase-server";

/** Возврат из GitHub: обмен кода на сессию и идемпотентная инициализация кошелька. */
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
  cookieStore.set(NEXT_COOKIE, "", { path: "/auth", maxAge: 0 });

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return toLogin("oauth");

  try {
    await ensureUserInitialized(supabase);
  } catch (e) {
    await supabase.auth.signOut({ scope: "local" });
    return toLogin(e instanceof AccountDisabledError ? "disabled" : "init");
  }

  return NextResponse.redirect(new URL(next, origin), 303);
}
