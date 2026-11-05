import "server-only";
import { z } from "zod";
import { WAIT_REASONS } from "@/domain/admin/wait-reason";
import type { ServerSupabase } from "@/server/db/supabase-server";

/** Отказ БД по роли (42501): наружу — 403, без подробностей. */
export class AdminForbiddenError extends Error {
  constructor() {
    super("FORBIDDEN");
    this.name = "AdminForbiddenError";
  }
}

function fail(name: string, error: { code?: string | null }): never {
  if (error.code === "42501") throw new AdminForbiddenError();
  throw new Error(`${name} failed: ${error.code ?? "unknown"}`);
}

/** Роль только из user_roles через is_admin(); false при любой ошибке не используется для отказа. */
export async function isCurrentUserAdmin(supabase: ServerSupabase): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_admin");
  if (error) fail("is_admin", error);
  return data === true;
}

const ts = z.string();
const stepErrors = z.array(z.object({ step: z.string(), message: z.string() })).catch([]);

const overviewSchema = z.object({
  now: ts,
  lastSuccessAt: ts.nullable(),
  lastFailure: z
    .object({
      startedAt: ts,
      status: z.string(),
      errorCode: z.string().nullable(),
      errors: stepErrors,
    })
    .nullable(),
  lease: z
    .object({ generation: z.number(), leaseUntil: ts.nullable(), held: z.boolean() })
    .nullable(),
  runs: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      startedAt: ts,
      finishedAt: ts.nullable(),
      generation: z.number().nullable(),
      errorCode: z.string().nullable(),
      requests: z.number(),
      syncStatus: z.string().nullable(),
      settled: z.number(),
      errors: stepErrors,
    }),
  ),
  requests24h: z.number(),
  providerBudget: z
    .object({ windowStart: ts, requestCount: z.number(), nextAllowedAt: ts.nullable() })
    .nullable(),
  staleMatches: z.number(),
  conflicts: z.number(),
  settlementFailures24h: z.number(),
});
export type AdminOverview = z.infer<typeof overviewSchema>;

const pendingSchema = z.array(
  z.object({
    market_id: z.string(),
    match_id: z.string(),
    kickoff_at: ts,
    competition_name: z.string(),
    home_name: z.string(),
    away_name: z.string(),
    match_status: z.string(),
    market_status: z.string(),
    result_kind: z.string(),
    home_score: z.number().nullable(),
    away_score: z.number().nullable(),
    result_first_seen_at: ts.nullable(),
    result_confirmed_at: ts.nullable(),
    result_conflict_at: ts.nullable(),
    last_seen_at: ts,
    pending_bets: z.number(),
    reason: z.enum(WAIT_REASONS),
    last_failure_at: ts.nullable(),
  }),
);

export interface PendingSettlement {
  marketId: string;
  matchId: string;
  kickoffAt: string;
  competitionName: string;
  homeName: string;
  awayName: string;
  matchStatus: string;
  marketStatus: string;
  resultKind: string;
  score: { home: number; away: number } | null;
  resultFirstSeenAt: string | null;
  resultConfirmedAt: string | null;
  resultConflictAt: string | null;
  lastSeenAt: string;
  pendingBets: number;
  reason: (typeof WAIT_REASONS)[number];
  lastFailureAt: string | null;
}

export interface AdminDashboard {
  overview: AdminOverview;
  pending: PendingSettlement[];
}

export async function getAdminDashboard(
  supabase: ServerSupabase,
  provider: string,
): Promise<AdminDashboard> {
  const [overviewRes, pendingRes] = await Promise.all([
    supabase.rpc("admin_overview", { p_provider: provider }),
    supabase.rpc("admin_pending_settlements", { p_provider: provider, p_limit: 50 }),
  ]);
  if (overviewRes.error) fail("admin_overview", overviewRes.error);
  if (pendingRes.error) fail("admin_pending_settlements", pendingRes.error);
  const overview = overviewSchema.parse(overviewRes.data);
  const pending = pendingSchema.parse(pendingRes.data).map((r): PendingSettlement => ({
    marketId: r.market_id,
    matchId: r.match_id,
    kickoffAt: r.kickoff_at,
    competitionName: r.competition_name,
    homeName: r.home_name,
    awayName: r.away_name,
    matchStatus: r.match_status,
    marketStatus: r.market_status,
    resultKind: r.result_kind,
    score:
      r.home_score !== null && r.away_score !== null
        ? { home: r.home_score, away: r.away_score }
        : null,
    resultFirstSeenAt: r.result_first_seen_at,
    resultConfirmedAt: r.result_confirmed_at,
    resultConflictAt: r.result_conflict_at,
    lastSeenAt: r.last_seen_at,
    pendingBets: r.pending_bets,
    reason: r.reason,
    lastFailureAt: r.last_failure_at,
  }));
  return { overview, pending };
}

/** Проверка роли, лимит 1/мин и аудит в БД; сам запуск выполняет вызывающий. */
export async function requestAdminSync(
  supabase: ServerSupabase,
): Promise<{ ok: true } | { ok: false; code: "RATE_LIMITED" }> {
  const { data, error } = await supabase.rpc("admin_request_sync");
  if (error) fail("admin_request_sync", error);
  const parsed = z
    .union([
      z.object({ ok: z.literal(true) }),
      z.object({ ok: z.literal(false), code: z.literal("RATE_LIMITED") }),
    ])
    .parse(data);
  return parsed.ok ? { ok: true } : { ok: false, code: "RATE_LIMITED" };
}

export const resolveConflictSchema = z.object({
  matchId: z.uuid(),
  note: z.string().trim().min(5).max(500),
});

/** false — конфликта нет (уже снят) или аргументы отклонены БД. */
export async function resolveConflict(
  supabase: ServerSupabase,
  input: z.infer<typeof resolveConflictSchema>,
): Promise<boolean> {
  const { error } = await supabase.rpc("admin_resolve_conflict", {
    p_match_id: input.matchId,
    p_note: input.note,
  });
  if (!error) return true;
  if (error.code === "22023") return false;
  fail("admin_resolve_conflict", error);
}
