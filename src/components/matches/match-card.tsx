import type { FixtureMatch, FixtureStatus } from "@/fixtures/demo-matches";
import { KickoffTime } from "./kickoff-time";

// Статус передаётся текстом, а не только цветом.
const STATUS_LABEL: Record<FixtureStatus, string> = {
  SCHEDULED: "Запланирован",
  FINISHED: "Завершён",
  CANCELLED: "Отменён",
  POSTPONED: "Перенесён",
  SUSPENDED: "Прерван",
};

export function MatchCard({ match }: { match: FixtureMatch }) {
  const hasScore = match.homeScore !== null && match.awayScore !== null;
  return (
    <li
      data-testid="match-card"
      className="rounded border border-border bg-surface p-4"
      aria-label={`${match.home} — ${match.away}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>{match.competition}</span>
        <span className="rounded border border-border px-2 py-0.5 font-medium text-fg">
          Статус: {STATUS_LABEL[match.status]}
        </span>
      </div>
      <p className="mt-2 text-lg font-semibold">
        {match.home} <span className="text-muted">—</span> {match.away}
      </p>
      <p className="mt-1">
        Счёт основного времени: {hasScore ? `${match.homeScore}:${match.awayScore}` : "—"}
      </p>
      <p className="mt-1 text-sm text-muted">
        Начало: <KickoffTime iso={match.kickoffAt} />
      </p>
      <p className="mt-2 text-sm">{match.note}</p>
    </li>
  );
}
