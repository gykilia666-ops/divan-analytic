import { z } from "zod";
import type { CompetitionDTO, MatchDTO } from "../types";
import { mapStatus, resolveResult, toUtcIso } from "./normalize";

const isoWithZone = z
  .string()
  .refine((value) => toUtcIso(value) !== null, "ожидается ISO-время с зоной");

const scorePair = z.object({
  home: z.number().int().min(0).nullable(),
  away: z.number().int().min(0).nullable(),
});

const teamSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(100),
  shortName: z.string().trim().max(60).nullish(),
});

const competitionSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().trim().min(1).max(10),
  name: z.string().trim().min(1).max(100),
});

const matchSchema = z.object({
  id: z.number().int().positive(),
  utcDate: isoWithZone,
  status: z.string().min(1).max(30),
  lastUpdated: isoWithZone.nullish(),
  competition: competitionSchema.optional(),
  homeTeam: teamSchema,
  awayTeam: teamSchema,
  score: z.object({
    duration: z.string().nullish(),
    fullTime: scorePair,
    regularTime: scorePair.nullish(),
  }),
});

export const matchesEnvelopeSchema = z.object({
  competition: competitionSchema.optional(),
  matches: z.array(z.unknown()).max(1000),
});

export const competitionsEnvelopeSchema = z.object({
  competitions: z.array(z.unknown()).max(500),
});

export type FdCompetition = z.infer<typeof competitionSchema>;

export function toCompetitionDTO(raw: unknown): CompetitionDTO | null {
  const parsed = competitionSchema.safeParse(raw);
  if (!parsed.success) return null;
  return { providerId: String(parsed.data.id), code: parsed.data.code, name: parsed.data.name };
}

/** Один элемент ответа → DTO или null (некорректный элемент отбрасывается и учитывается). */
export function toMatchDTO(raw: unknown, fallback?: FdCompetition): MatchDTO | null {
  const parsed = matchSchema.safeParse(raw);
  if (!parsed.success) return null;
  const m = parsed.data;

  const competition = m.competition ?? fallback;
  const status = mapStatus(m.status);
  const kickoffAt = toUtcIso(m.utcDate);
  if (!competition || !status || !kickoffAt) return null;
  if (m.homeTeam.id === m.awayTeam.id) return null;

  const result = resolveResult({
    rawStatus: m.status,
    duration: m.score.duration,
    fullTime: m.score.fullTime,
    regularTime: m.score.regularTime,
  });

  return {
    providerId: String(m.id),
    competition: {
      providerId: String(competition.id),
      code: competition.code,
      name: competition.name,
    },
    home: {
      providerId: String(m.homeTeam.id),
      name: m.homeTeam.name,
      shortName: m.homeTeam.shortName ?? null,
    },
    away: {
      providerId: String(m.awayTeam.id),
      name: m.awayTeam.name,
      shortName: m.awayTeam.shortName ?? null,
    },
    kickoffAt,
    status,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    resultKind: result.resultKind,
    providerUpdatedAt: m.lastUpdated ? toUtcIso(m.lastUpdated) : null,
  };
}
