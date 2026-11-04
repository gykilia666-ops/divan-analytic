import Link from "next/link";
import type { CatalogMatch } from "@/server/catalog/types";
import { AcceptanceNote } from "./acceptance-note";
import { KickoffTime } from "./kickoff-time";
import { MATCH_STATUS_LABEL } from "./labels";
import { OddsRow } from "./odds-row";

export function MatchCard({
  match,
  timeZone,
  href,
}: {
  match: CatalogMatch;
  timeZone: string | null;
  href: string;
}) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  return (
    <li
      data-testid="match-card"
      className="flex flex-col rounded border border-border bg-surface p-4"
      aria-label={`${match.home} — ${match.away}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{match.competition.name}</span>
        <span className="rounded border border-border px-2 py-0.5 font-medium text-fg">
          Статус: {MATCH_STATUS_LABEL[match.status]}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold">
        <Link href={href} className="underline-offset-4 hover:underline">
          {match.home} <span className="text-muted">—</span> {match.away}
        </Link>
      </p>
      <p className="mt-1">
        Счёт основного времени: {hasScore ? `${match.homeScore}:${match.awayScore}` : "—"}
        {match.resultKind === "AMBIGUOUS" ? " (итог неоднозначен, на проверке)" : ""}
      </p>
      <p className="mt-1 text-sm text-muted">
        Начало: <KickoffTime iso={match.kickoffAt} timeZone={timeZone} />
      </p>
      {match.market ? <OddsRow market={match.market} dimmed={!match.acceptance.accepting} /> : null}
      <AcceptanceNote match={match} timeZone={timeZone} />
      {match.stale ? (
        <p className="mt-1 text-sm font-medium text-warn-fg" role="note">
          Внимание: данные по матчу могут быть устаревшими.
        </p>
      ) : null}
      {match.note ? <p className="mt-2 text-sm text-muted">{match.note}</p> : null}
    </li>
  );
}
