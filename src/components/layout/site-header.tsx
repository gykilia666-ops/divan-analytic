import Link from "next/link";

// Ссылки добавляются только на существующие страницы.
const NAV = [
  { href: "/matches", label: "Матчи" },
  { href: "/rules", label: "Правила" },
  { href: "/privacy", label: "Приватность" },
] as const;

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-accent">
          Диванный аналитик
        </Link>
        <nav aria-label="Основная навигация">
          <ul className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className="underline-offset-4 hover:underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
