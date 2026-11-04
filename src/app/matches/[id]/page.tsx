import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatOdds } from "@/domain/odds/demo-odds";
import { AcceptanceNote } from "@/components/matches/acceptance-note";
import { KickoffTime } from "@/components/matches/kickoff-time";
import { MATCH_STATUS_LABEL, OUTCOME_LABEL } from "@/components/matches/labels";
import { isValidTimeZone } from "@/lib/time";
import { getMatch, loadSafely } from "@/server/catalog";

export const metadata: Metadata = { title: "Матч" };
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MatchPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { tz } = await searchParams;
  const timeZone = typeof tz === "string" && tz.length <= 64 && isValidTimeZone(tz) ? tz : null;
  const result = await loadSafely(() => getMatch(id));

  if (!result.ok) {
    return (
      <p role="alert" className="rounded border border-border bg-warn-bg p-3 text-warn-fg">
        Не удалось загрузить матч. Попробуйте позже.
      </p>
    );
  }
  const match = result.value;
  if (!match) notFound();

  const hasScore = match.homeScore !== null && match.awayScore !== null;
  const outcomes = ["home", "draw", "away"] as const;
  const market = match.market;

  return (
    <article className="max-w-2xl space-y-4">
      <p className="text-sm">
        <Link
          href={`/matches${timeZone ? `?tz=${encodeURIComponent(timeZone)}` : ""}`}
          className="underline"
        >
          ← Все матчи
        </Link>
      </p>
      <p className="text-sm text-muted">{match.competition.name}</p>
      <h1 className="text-2xl font-bold">
        {match.home} — {match.away}
      </h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Начало</dt>
        <dd>
          <KickoffTime iso={match.kickoffAt} timeZone={timeZone} />
        </dd>
        <dt className="text-muted">Статус</dt>
        <dd data-testid="match-status">{MATCH_STATUS_LABEL[match.status]}</dd>
        <dt className="text-muted">Счёт основного времени</dt>
        <dd>
          {hasScore ? `${match.homeScore}:${match.awayScore}` : "—"}
          {match.resultKind === "AMBIGUOUS" ? " (итог неоднозначен, на проверке)" : ""}
        </dd>
        <dt className="text-muted">Данные обновлены</dt>
        <dd>
          {match.lastSeenAt ? <KickoffTime iso={match.lastSeenAt} timeZone={timeZone} /> : "—"}
        </dd>
      </dl>

      {match.stale ? (
        <p role="note" className="rounded border border-border bg-warn-bg p-3 text-warn-fg">
          Данные по матчу обновлялись больше часа назад — новые прогнозы не принимаются.
        </p>
      ) : null}

      <section aria-labelledby="outcomes" className="space-y-2">
        <h2 id="outcomes" className="text-xl font-semibold">
          Исход основного времени
        </h2>
        {market ? (
          <ul className="grid gap-2 sm:grid-cols-3">
            {outcomes.map((key) => (
              <li key={key} className="rounded border border-border bg-surface p-3 text-center">
                <p className="text-sm text-muted">
                  {OUTCOME_LABEL[key].long} ({OUTCOME_LABEL[key].short})
                </p>
                <p className="text-2xl font-bold tabular-nums" data-testid={`odds-${key}`}>
                  {formatOdds(market.odds[key])}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <AcceptanceNote match={match} timeZone={timeZone} />
        {match.market ? (
          <p className="text-xs text-muted">
            Модель коэффициентов: {match.market.modelVersion}, версия котировки{" "}
            {match.market.quoteVersion}. Выплата = сумма × коэффициент (округление вниз) и включает
            сумму прогноза.
          </p>
        ) : null}
        <p className="rounded border border-border bg-surface p-3 text-sm">
          Купон для прогноза появится на следующем этапе разработки.
        </p>
      </section>

      {match.note ? <p className="text-sm text-muted">Сценарий демо: {match.note}</p> : null}
    </article>
  );
}
