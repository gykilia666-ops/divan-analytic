import {
  DEMO_MATCHES,
  type FixtureMatch,
  type ProviderFaultFixture,
} from "@/fixtures/demo-matches";
import {
  ProviderError,
  type CompetitionDTO,
  type MatchBatch,
  type MatchDTO,
  type MatchQuery,
  type ResultKind,
  type SportsProvider,
  type TeamDTO,
} from "../types";

export const FIXTURE_COMPETITION: CompetitionDTO = {
  providerId: "demo-league",
  code: "LD",
  name: "Лига Дивана",
};

function team(name: string): TeamDTO {
  return { providerId: `team:${name}`, name, shortName: null };
}

export function fixtureToMatchDTO(match: FixtureMatch): MatchDTO {
  const scored = match.homeScore !== null && match.awayScore !== null;
  const ambiguous = match.scenario === "AMBIGUOUS_RESULT";
  const regular = match.status === "FINISHED" && scored && !ambiguous;
  const resultKind: ResultKind = ambiguous ? "AMBIGUOUS" : regular ? "REGULAR" : "NONE";

  return {
    providerId: match.id,
    competition: FIXTURE_COMPETITION,
    home: team(match.home),
    away: team(match.away),
    kickoffAt: new Date(match.kickoffAt).toISOString(),
    status: match.status,
    homeScore: regular ? match.homeScore : null,
    awayScore: regular ? match.awayScore : null,
    resultKind,
    providerUpdatedAt: match.providerUpdatedAt,
  };
}

/**
 * Поставщик на демонстрационных данных: без сети и ключей. Диапазон дат игнорируется —
 * fixtures привязаны к фиксированному «текущему моменту» DEMO_NOW. Сбой задается явно.
 */
export class FixtureSportsProvider implements SportsProvider {
  readonly id = "fixtures";
  private readonly fault: ProviderFaultFixture | undefined;
  private readonly matches: readonly FixtureMatch[];

  constructor(options: { fault?: ProviderFaultFixture; matches?: readonly FixtureMatch[] } = {}) {
    this.fault = options.fault;
    this.matches = options.matches ?? DEMO_MATCHES;
  }

  async getCompetitions(): Promise<CompetitionDTO[]> {
    return [FIXTURE_COMPETITION];
  }

  async getMatches(query: MatchQuery): Promise<MatchBatch> {
    if (this.fault?.kind === "RATE_LIMITED") {
      throw new ProviderError("RATE_LIMITED", "fixtures: 429", {
        httpStatus: 429,
        retryAfterSeconds: this.fault.retryAfterSeconds,
      });
    }
    if (this.fault?.kind === "TIMEOUT") {
      throw new ProviderError("TIMEOUT", "fixtures: таймаут");
    }
    if (query.competitionCode !== FIXTURE_COMPETITION.code) {
      return { matches: [], invalidCount: 0 };
    }

    if (this.fault?.kind === "PARTIAL_INVALID_RESPONSE") {
      const valid = new Set(this.fault.validMatchIds);
      return {
        matches: this.matches.filter((m) => valid.has(m.id)).map(fixtureToMatchDTO),
        invalidCount: this.fault.invalidItemCount,
      };
    }
    return { matches: this.matches.map(fixtureToMatchDTO), invalidCount: 0 };
  }
}
