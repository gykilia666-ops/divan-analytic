import type { MatchDTO } from "../providers/types";

/** Форма аргумента SQL-функции sync_upsert_matches (snake_case, без доменной логики). */
export interface UpsertPayload {
  competitions: { provider_id: string; code: string; name: string }[];
  teams: { provider_id: string; name: string; short_name: string | null }[];
  matches: {
    provider_id: string;
    competition_provider_id: string;
    home_provider_id: string;
    away_provider_id: string;
    kickoff_at: string;
    status: MatchDTO["status"];
    home_score: number | null;
    away_score: number | null;
    result_kind: MatchDTO["resultKind"];
    provider_updated_at: string | null;
  }[];
}

function newer(a: MatchDTO, b: MatchDTO): boolean {
  if (a.providerUpdatedAt === null) return false;
  if (b.providerUpdatedAt === null) return true;
  return a.providerUpdatedAt > b.providerUpdatedAt;
}

/**
 * Собирает payload без дубликатов: один и тот же матч из разных ответов остается один раз
 * (с самым свежим providerUpdatedAt), команды и соревнования — уникальны.
 */
export function buildUpsertPayload(matches: readonly MatchDTO[]): UpsertPayload {
  const byId = new Map<string, MatchDTO>();
  for (const match of matches) {
    const existing = byId.get(match.providerId);
    if (!existing || newer(match, existing)) byId.set(match.providerId, match);
  }

  const competitions = new Map<string, UpsertPayload["competitions"][number]>();
  const teams = new Map<string, UpsertPayload["teams"][number]>();
  const rows: UpsertPayload["matches"] = [];

  for (const m of byId.values()) {
    competitions.set(m.competition.providerId, {
      provider_id: m.competition.providerId,
      code: m.competition.code,
      name: m.competition.name,
    });
    for (const t of [m.home, m.away]) {
      teams.set(t.providerId, { provider_id: t.providerId, name: t.name, short_name: t.shortName });
    }
    rows.push({
      provider_id: m.providerId,
      competition_provider_id: m.competition.providerId,
      home_provider_id: m.home.providerId,
      away_provider_id: m.away.providerId,
      kickoff_at: m.kickoffAt,
      status: m.status,
      home_score: m.homeScore,
      away_score: m.awayScore,
      result_kind: m.resultKind,
      provider_updated_at: m.providerUpdatedAt,
    });
  }

  return { competitions: [...competitions.values()], teams: [...teams.values()], matches: rows };
}
