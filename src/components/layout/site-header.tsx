import { cookies } from "next/headers";
import Link from "next/link";
import { getEnv } from "@/lib/env";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { ThemeToggle } from "./theme-toggle";
import { getCurrentProfile, getCurrentUser, type CurrentProfile } from "@/server/auth/session";

// Ссылки добавляются только на существующие страницы.
const NAV = [
  { href: "/matches", label: "Матчи" },
  { href: "/leaderboard", label: "Рейтинг" },
  { href: "/rules", label: "Правила" },
  { href: "/privacy", label: "Приватность" },
] as const;

async function loadProfile(): Promise<CurrentProfile | null> {
  try {
    return await getCurrentProfile();
  } catch {
    // Сбой БД не должен ронять всю страницу: меню пользователя просто не показываем.
    return null;
  }
}

async function loadSignedIn(): Promise<boolean> {
  try {
    return (await getCurrentUser()) !== null;
  } catch {
    return false;
  }
}

export async function SiteHeader() {
  const connected = getEnv().APP_DATA_MODE === "connected";
  const signedIn = connected ? await loadSignedIn() : false;
  // Профиля до выбора псевдонима нет (ADR-075): вошедший без профиля видит только выбор имени и выход.
  const profile = signedIn ? await loadProfile() : null;
  const displayName = profile?.displayName ?? null;
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="font-[family-name:var(--font-logo)] text-xl tracking-wide text-accent uppercase"
        >
          Диванный аналитик
        </Link>
        <nav aria-label="Основная навигация">
          <ul className="flex flex-wrap items-center gap-4 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="underline-offset-4 hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
            {signedIn ? (
              <>
                {displayName ? (
                  <>
                    <li>
                      <Link href="/my/bets" className="underline-offset-4 hover:underline">
                        Мои прогнозы
                      </Link>
                    </li>
                    <li>
                      <Link href="/my/stats" className="underline-offset-4 hover:underline">
                        Статистика
                      </Link>
                    </li>
                    <li>
                      <Link href="/my/wallet" className="underline-offset-4 hover:underline">
                        Кошелёк
                      </Link>
                    </li>
                  </>
                ) : null}
                <li data-testid="user-name" className="font-medium">
                  <Link
                    href={displayName ? "/my/account" : "/my/pseudonym"}
                    title={displayName ? "Аккаунт" : "Выберите псевдоним"}
                    className="underline-offset-4 hover:underline"
                  >
                    {displayName ?? "Выбрать псевдоним"}
                  </Link>
                </li>
                <li>
                  <form action="/auth/signout" method="post">
                    <button type="submit" className="underline underline-offset-4">
                      Выйти
                    </button>
                  </form>
                </li>
              </>
            ) : connected ? (
              <li>
                <Link href="/login" className="font-medium underline underline-offset-4">
                  Войти
                </Link>
              </li>
            ) : null}
            <li>
              <ThemeToggle initial={theme} />
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
