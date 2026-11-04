import type { Metadata } from "next";
import Link from "next/link";
import { CatalogFilters } from "@/components/matches/catalog-filters";
import { KickoffTime } from "@/components/matches/kickoff-time";
import { MatchCard } from "@/components/matches/match-card";
import { getCatalog, loadSafely } from "@/server/catalog";
import { catalogSearch, parseCatalogQuery } from "@/server/catalog/parse-query";

export const metadata: Metadata = { title: "Матчи" };
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MatchesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = parseCatalogQuery(params);
  // Явно выбранная зона: тогда сервер сразу показывает время в ней.
  const explicitTimeZone =
    typeof params.tz === "string" && params.tz === query.timeZone ? query.timeZone : null;
  const result = await loadSafely(() => getCatalog(query));

  if (!result.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Матчи</h1>
        <p role="alert" className="rounded border border-border bg-warn-bg p-3 text-warn-fg">
          Не удалось загрузить матчи. Попробуйте обновить страницу чуть позже.
        </p>
      </div>
    );
  }

  const page = result.value;
  const keep = (id: string) =>
    `/matches/${encodeURIComponent(id)}${explicitTimeZone ? `?tz=${encodeURIComponent(explicitTimeZone)}` : ""}`;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Матчи</h1>

      <div
        className="rounded border border-border bg-surface p-3 text-sm"
        data-testid="matches-note"
      >
        {page.source === "demo" ? (
          <p>
            Вымышленные матчи демонстрационного набора. «Текущий момент» демо:{" "}
            <KickoffTime iso={page.now} timeZone={explicitTimeZone} />.
          </p>
        ) : (
          <p>
            Данные поставщика могут приходить с задержкой.{" "}
            {page.lastSyncedAt ? (
              <>
                Последнее обновление:{" "}
                <KickoffTime iso={page.lastSyncedAt} timeZone={explicitTimeZone} />.
              </>
            ) : (
              "Синхронизация еще не выполнялась."
            )}
          </p>
        )}
        <p className="mt-1">
          Коэффициенты демонстрационные. Прием прогнозов закрывается за 5 минут до начала матча.
        </p>
      </div>

      <CatalogFilters
        query={query}
        competitions={page.competitions}
        explicitTimeZone={explicitTimeZone}
      />

      <p className="text-sm text-muted" data-testid="timezone-label">
        {explicitTimeZone
          ? `Время и фильтр по дате — в зоне ${explicitTimeZone}.`
          : "Время показано в зоне вашего браузера; фильтр по дате без выбранной зоны считается в UTC."}
      </p>

      {page.items.length === 0 ? (
        <p className="rounded border border-border bg-surface p-4" data-testid="matches-empty">
          Матчей по выбранным условиям нет.{" "}
          <Link href="/matches" className="underline">
            Сбросить фильтры
          </Link>
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {page.items.map((m) => (
            <MatchCard key={m.id} match={m} timeZone={explicitTimeZone} href={keep(m.id)} />
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <p>
          <Link
            href={`/matches${catalogSearch(query, { cursor: page.nextCursor })}`}
            className="underline"
            data-testid="next-page"
          >
            Следующие матчи →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
