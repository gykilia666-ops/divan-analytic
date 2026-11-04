import { acceptanceState, isStale, type MarketStatus } from "@/domain/markets/acceptance";
import { computeDemoOdds, DEMO_MODEL_VERSION } from "@/domain/odds/demo-odds";
import { DEMO_MATCHES, DEMO_NOW, type FixtureMatch } from "@/fixtures/demo-matches";
import { zonedDayToUtcRange } from "@/lib/day-range";
import { decodeCursor, encodeCursor } from "./cursor";
import type { CatalogMatch, CatalogPage, CatalogQuery } from "./types";

const DEMO_COMPETITION = { code: "LD", name: "Лига Дивана" };

/**
 * Статус рынка демо-матча — как его выставила бы синхронизация. Запланированный матч остается
 * OPEN даже за 3 минуты до старта: так видно, что прием закрывает время, а не задание.
 */
function demoMarketStatus(match: FixtureMatch): MarketStatus {
  if (match.status === "FINISHED") return "CLOSED";
  if (match.status !== "SCHEDULED") return "SUSPENDED";
  return "OPEN";
}

export function demoMatchToCatalog(match: FixtureMatch, now: string = DEMO_NOW): CatalogMatch {
  const odds = computeDemoOdds("fixtures", match.id, DEMO_MODEL_VERSION);
  const marketStatus = odds ? demoMarketStatus(match) : null;
  const scored = match.homeScore !== null && match.awayScore !== null;
  const ambiguous = match.scenario === "AMBIGUOUS_RESULT";
  const regular = match.status === "FINISHED" && scored && !ambiguous;

  return {
    id: match.id,
    competition: DEMO_COMPETITION,
    home: match.home,
    away: match.away,
    kickoffAt: new Date(match.kickoffAt).toISOString(),
    status: match.status,
    homeScore: regular ? match.homeScore : null,
    awayScore: regular ? match.awayScore : null,
    resultKind: ambiguous ? "AMBIGUOUS" : regular ? "REGULAR" : "NONE",
    lastSeenAt: match.providerUpdatedAt,
    stale: isStale(match.providerUpdatedAt, now),
    market:
      odds && marketStatus
        ? {
            id: `market-${match.id}`,
            status: marketStatus,
            quoteVersion: 1,
            modelVersion: DEMO_MODEL_VERSION,
            odds,
          }
        : null,
    acceptance: acceptanceState({
      marketStatus,
      matchStatus: match.status,
      kickoffAt: match.kickoffAt,
      lastSeenAt: match.providerUpdatedAt,
      now,
    }),
    note: match.note,
  };
}

function compare(a: CatalogMatch, b: CatalogMatch): number {
  return a.kickoffAt.localeCompare(b.kickoffAt) || a.id.localeCompare(b.id);
}

/** Каталог демо-режима: вымышленные матчи, фиксированное время, без БД. */
export function getDemoCatalog(query: CatalogQuery, now: string = DEMO_NOW): CatalogPage {
  let items = DEMO_MATCHES.map((m) => demoMatchToCatalog(m, now));

  if (query.competition && query.competition !== DEMO_COMPETITION.code) items = [];
  if (query.date) {
    const { from, to } = zonedDayToUtcRange(query.date, query.timeZone);
    items = items.filter((m) => m.kickoffAt >= from && m.kickoffAt < to);
  }
  const done = (m: CatalogMatch) => m.status === "FINISHED" || m.status === "CANCELLED";
  if (query.scope === "upcoming") items = items.filter((m) => !done(m));
  if (query.scope === "finished") items = items.filter(done);

  const desc = query.scope === "finished";
  items.sort((a, b) => (desc ? compare(b, a) : compare(a, b)));

  const cursor = decodeCursor(query.cursor);
  if (cursor) {
    const pivot = { kickoffAt: cursor.kickoffAt, id: cursor.id } as CatalogMatch;
    items = items.filter((m) => (desc ? compare(m, pivot) < 0 : compare(m, pivot) > 0));
  }

  const page = items.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    items.length > query.limit && last
      ? encodeCursor({ kickoffAt: last.kickoffAt, id: last.id })
      : null;

  const seen = page
    .map((m) => m.lastSeenAt)
    .filter((v): v is string => v !== null)
    .sort();
  return {
    items: page,
    nextCursor,
    competitions: [DEMO_COMPETITION],
    now,
    lastSyncedAt: seen[seen.length - 1] ?? null,
    source: "demo",
  };
}

export function getDemoMatch(id: string, now: string = DEMO_NOW): CatalogMatch | null {
  const match = DEMO_MATCHES.find((m) => m.id === id);
  return match ? demoMatchToCatalog(match, now) : null;
}
