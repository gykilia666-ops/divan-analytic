import { PROVIDER_MAX_RANGE_DAYS, rangeDays } from "@/lib/date-range";
import {
  ProviderError,
  type CompetitionDTO,
  type MatchBatch,
  type MatchDTO,
  type MatchQuery,
  type SportsProvider,
} from "../types";
import type { FootballDataClient } from "./client";
import {
  competitionsEnvelopeSchema,
  matchesEnvelopeSchema,
  toCompetitionDTO,
  toMatchDTO,
} from "./parse";

const COMPETITION_CODE = /^[A-Z0-9]{2,5}$/;

export class FootballDataProvider implements SportsProvider {
  readonly id = "football-data";
  private readonly client: FootballDataClient;

  constructor(client: FootballDataClient) {
    this.client = client;
  }

  async getCompetitions(): Promise<CompetitionDTO[]> {
    const parsed = competitionsEnvelopeSchema.safeParse(await this.client.getJson("/competitions"));
    if (!parsed.success) {
      throw new ProviderError("INVALID_RESPONSE", "football-data: неожиданная форма /competitions");
    }
    return parsed.data.competitions
      .map((item) => toCompetitionDTO(item))
      .filter((item): item is CompetitionDTO => item !== null);
  }

  async getMatches(query: MatchQuery): Promise<MatchBatch> {
    if (!COMPETITION_CODE.test(query.competitionCode)) {
      throw new Error("FootballDataProvider: некорректный код соревнования");
    }
    const days = rangeDays(query.dateFrom, query.dateTo);
    if (days === null || days < 0 || days > PROVIDER_MAX_RANGE_DAYS) {
      throw new Error("FootballDataProvider: некорректный диапазон дат");
    }

    const params = new URLSearchParams({ dateFrom: query.dateFrom, dateTo: query.dateTo });
    const raw = await this.client.getJson(
      `/competitions/${query.competitionCode}/matches?${params.toString()}`,
    );
    const envelope = matchesEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      throw new ProviderError("INVALID_RESPONSE", "football-data: неожиданная форма /matches");
    }

    const matches: MatchDTO[] = [];
    let invalidCount = 0;
    for (const item of envelope.data.matches) {
      const dto = toMatchDTO(item, envelope.data.competition);
      if (dto) matches.push(dto);
      else invalidCount += 1;
    }
    return { matches, invalidCount };
  }
}
