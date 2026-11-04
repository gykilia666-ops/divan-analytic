import { describe, expect, it } from "vitest";
import { buildUpsertPayload } from "@/server/jobs/upsert-payload";
import type { MatchDTO } from "@/server/providers/types";

function match(id: string, updatedAt: string | null, extra: Partial<MatchDTO> = {}): MatchDTO {
  return {
    providerId: id,
    competition: { providerId: "2021", code: "PL", name: "Premier League" },
    home: { providerId: "64", name: "Liverpool FC", shortName: "Liverpool" },
    away: { providerId: "397", name: "Brighton", shortName: null },
    kickoffAt: "2026-10-25T14:00:00.000Z",
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    resultKind: "NONE",
    providerUpdatedAt: updatedAt,
    ...extra,
  };
}

describe("buildUpsertPayload", () => {
  it("пустой ввод", () => {
    expect(buildUpsertPayload([])).toEqual({ competitions: [], teams: [], matches: [] });
  });

  it("формирует snake_case строки", () => {
    const payload = buildUpsertPayload([
      match("1", "2026-11-04T00:00:00.000Z", {
        status: "FINISHED",
        resultKind: "REGULAR",
        homeScore: 2,
        awayScore: 0,
      }),
    ]);
    expect(payload.matches).toEqual([
      {
        provider_id: "1",
        competition_provider_id: "2021",
        home_provider_id: "64",
        away_provider_id: "397",
        kickoff_at: "2026-10-25T14:00:00.000Z",
        status: "FINISHED",
        home_score: 2,
        away_score: 0,
        result_kind: "REGULAR",
        provider_updated_at: "2026-11-04T00:00:00.000Z",
      },
    ]);
    expect(payload.teams).toHaveLength(2);
    expect(payload.competitions).toEqual([
      { provider_id: "2021", code: "PL", name: "Premier League" },
    ]);
  });

  it("дубликаты матча схлопываются в самое свежее наблюдение", () => {
    const payload = buildUpsertPayload([
      match("1", "2026-11-04T00:00:00.000Z", { status: "SCHEDULED" }),
      match("1", "2026-11-04T01:00:00.000Z", { status: "POSTPONED" }),
      match("1", null, { status: "CANCELLED" }),
      match("1", "2026-11-03T23:00:00.000Z", { status: "SUSPENDED" }),
    ]);
    expect(payload.matches).toHaveLength(1);
    expect(payload.matches[0]?.status).toBe("POSTPONED");
  });

  it("команды и соревнования не дублируются", () => {
    const payload = buildUpsertPayload([match("1", null), match("2", null), match("3", null)]);
    expect(payload.matches).toHaveLength(3);
    expect(payload.teams).toHaveLength(2);
    expect(payload.competitions).toHaveLength(1);
  });
});
