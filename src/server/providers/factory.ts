import "server-only";
import type { AppEnv } from "@/lib/env";
import { FootballDataClient } from "./football-data/client";
import { MVP_COMPETITIONS } from "./football-data/competitions";
import { FootballDataProvider } from "./football-data/provider";
import { FIXTURE_COMPETITION, FixtureSportsProvider } from "./fixtures/provider";
import type { SportsProvider } from "./types";

/** Поставщик и список соревнований по SPORTS_PROVIDER (противоречия отсекает env.ts). */
export function createSportsProvider(env: AppEnv): {
  provider: SportsProvider;
  competitions: readonly string[];
} {
  if (env.SPORTS_PROVIDER === "football-data") {
    const token = env.FOOTBALL_DATA_API_KEY;
    if (!token) throw new Error("FOOTBALL_DATA_API_KEY не задан");
    return {
      provider: new FootballDataProvider(new FootballDataClient({ token, timeoutMs: 10_000 })),
      competitions: MVP_COMPETITIONS,
    };
  }
  return { provider: new FixtureSportsProvider(), competitions: [FIXTURE_COMPETITION.code] };
}
