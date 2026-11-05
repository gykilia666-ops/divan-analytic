import Link from "next/link";
import { HideOnLogin } from "@/components/layout/hide-on-login";
import { getEnv } from "@/lib/env";
import { LEGAL_LINKS } from "@/lib/legal";

export const DISCLAIMER =
  "Учебный симулятор. Монеты не имеют денежной стоимости. Коэффициенты демонстрационные. Спортивные данные могут поступать с задержкой.";

export function SiteFooter() {
  // Условие поставщика: ссылка на источник данных, когда данные берутся у football-data.org.
  const footballData = getEnv().SPORTS_PROVIDER === "football-data";
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto w-full max-w-5xl px-4 py-3 text-xs text-muted">
        <p data-testid="disclaimer">{DISCLAIMER}</p>
        <HideOnLogin>
          <p className="mt-1">Монеты ненастоящие. Уверенность — настоящая.</p>
        </HideOnLogin>
        <HideOnLogin>
          <nav aria-label="Юридические документы" className="mt-2">
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {LEGAL_LINKS.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="underline underline-offset-2">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </HideOnLogin>
        <p className="mt-2">
          <span
            data-testid="age-mark"
            className="mr-2 rounded border border-border px-1.5 py-0.5 font-semibold"
          >
            18+
          </span>
          Сервис предназначен для лиц старше 18 лет. Названия клубов и соревнований принадлежат их
          владельцам; проект независим и не связан с клубами, лигами и организаторами соревнований.
        </p>
        {footballData ? (
          <p className="mt-1" data-testid="data-attribution">
            Football data provided by the{" "}
            <a
              href="https://www.football-data.org/"
              className="underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              Football-Data.org
            </a>{" "}
            API
          </p>
        ) : null}
        <p className="mt-1">
          Фото на фоне:{" "}
          <a
            href="https://unsplash.com/photos/wcNU1-OY-BA"
            className="underline underline-offset-2"
            rel="noopener noreferrer"
            target="_blank"
          >
            Alfonso Scarpa, Unsplash
          </a>
        </p>
      </div>
    </footer>
  );
}
