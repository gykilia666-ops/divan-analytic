import type { Metadata } from "next";
import { DEMO_MATCHES, DEMO_NOW } from "@/fixtures/demo-matches";
import { MatchCard } from "@/components/matches/match-card";
import { KickoffTime } from "@/components/matches/kickoff-time";

export const metadata: Metadata = { title: "Матчи" };

export default function MatchesPage() {
  // Этап 1: только демонстрационные данные. Реальный каталог, фильтры и пагинация — этап 5.
  const sorted = [...DEMO_MATCHES].sort(
    (a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.id.localeCompare(b.id),
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Матчи</h1>
      <p className="rounded border border-border bg-surface p-3 text-sm" data-testid="matches-note">
        Показаны вымышленные матчи демонстрационного набора. «Текущий момент» демо:{" "}
        <KickoffTime iso={DEMO_NOW} />. Фильтры, коэффициенты и прогнозы появятся на следующих этапах.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {sorted.map((m) => (
          <MatchCard key={m.id} match={m} />
        ))}
      </ul>
    </div>
  );
}
