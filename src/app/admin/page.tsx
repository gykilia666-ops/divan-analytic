import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResolveConflictForm } from "@/components/admin/resolve-conflict-form";
import { SyncButton } from "@/components/admin/sync-button";
import { KickoffTime } from "@/components/matches/kickoff-time";
import { explainWait } from "@/domain/admin/wait-reason";
import { getEnv } from "@/lib/env";
import { getAdminDashboard, isCurrentUserAdmin, type AdminDashboard } from "@/server/admin";
import { requireUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";

export const metadata: Metadata = { title: "Админка", robots: { index: false } };
export const dynamic = "force-dynamic";

type Access = { kind: "denied" } | { kind: "error" } | { kind: "ok"; data: AdminDashboard };

/** Роль проверяется на сервере при каждом запросе; не администратору — 404 (раздел не раскрывается). */
async function load(provider: string): Promise<Access> {
  try {
    const supabase = await createClient();
    if (!(await isCurrentUserAdmin(supabase))) return { kind: "denied" };
    return { kind: "ok", data: await getAdminDashboard(supabase, provider) };
  } catch {
    return { kind: "error" };
  }
}

const RUN_LABEL: Record<string, string> = {
  OK: "Успешно",
  PARTIAL: "Частично",
  SKIPPED: "Пропущен (занято)",
  FAILED: "Ошибка",
  RUNNING: "Выполняется",
};

function Time({ iso }: { iso: string | null | undefined }) {
  return iso ? <KickoffTime iso={iso} /> : <span>—</span>;
}

function Stat({ label, value, testId }: { label: string; value: React.ReactNode; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd data-testid={testId} className="font-semibold">
        {value}
      </dd>
    </div>
  );
}

export default async function AdminPage() {
  const env = getEnv();
  if (env.APP_DATA_MODE !== "connected") notFound();
  await requireUser("/admin");
  const access = await load(env.SPORTS_PROVIDER);
  if (access.kind === "denied") notFound();
  if (access.kind === "error") {
    return (
      <div role="alert" className="space-y-2">
        <h1 className="text-2xl font-bold">Админка</h1>
        <p>Не удалось загрузить диагностику. Попробуйте позже.</p>
      </div>
    );
  }

  const { overview: o, pending } = access.data;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Админка</h1>
        <p className="text-sm text-muted">
          Режим: {env.APP_DATA_MODE}. Поставщик: {env.SPORTS_PROVIDER}. Время сервера БД:{" "}
          <Time iso={o.now} />.
        </p>
        <SyncButton />
      </div>

      <section aria-labelledby="health" className="space-y-3">
        <h2 id="health" className="text-xl font-semibold">
          Состояние задания
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Последний успех"
            value={<Time iso={o.lastSuccessAt} />}
            testId="admin-last-success"
          />
          <Stat
            label="Последняя ошибка"
            value={
              o.lastFailure ? (
                <>
                  <Time iso={o.lastFailure.startedAt} /> ·{" "}
                  {RUN_LABEL[o.lastFailure.status] ?? o.lastFailure.status}
                  {o.lastFailure.errors.length > 0
                    ? ` (${o.lastFailure.errors.map((e) => `${e.step}: ${e.message}`).join(", ")})`
                    : o.lastFailure.errorCode
                      ? ` (${o.lastFailure.errorCode})`
                      : ""}
                </>
              ) : (
                "нет"
              )
            }
            testId="admin-last-failure"
          />
          <Stat
            label="Аренда"
            value={
              o.lease?.held ? (
                <>
                  занята до <Time iso={o.lease.leaseUntil} />
                </>
              ) : (
                "свободна"
              )
            }
            testId="admin-lease"
          />
          <Stat
            label="Запросов к поставщику за 24 ч"
            value={o.requests24h}
            testId="admin-requests"
          />
          <Stat
            label="Текущее окно лимита"
            value={
              o.providerBudget ? (
                <>
                  {o.providerBudget.requestCount} запр. с{" "}
                  <Time iso={o.providerBudget.windowStart} />
                  {o.providerBudget.nextAllowedAt ? (
                    <>
                      ; пауза до <Time iso={o.providerBudget.nextAllowedAt} />
                    </>
                  ) : null}
                </>
              ) : (
                "запросов не было"
              )
            }
            testId="admin-budget"
          />
          <Stat
            label="Устаревшие данные / конфликты / сбои расчета (24 ч)"
            value={`${o.staleMatches} / ${o.conflicts} / ${o.settlementFailures24h}`}
            testId="admin-problems"
          />
        </dl>
      </section>

      <section aria-labelledby="queue" className="space-y-3">
        <h2 id="queue" className="text-xl font-semibold">
          Ожидают расчета ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p data-testid="admin-queue-empty">Очередь пуста: все начавшиеся матчи рассчитаны.</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((p) => {
              const why = explainWait({
                reason: p.reason,
                kickoffAt: p.kickoffAt,
                resultFirstSeenAt: p.resultFirstSeenAt,
              });
              return (
                <li
                  key={p.marketId}
                  data-testid="admin-pending"
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <p className="font-medium">
                    {p.homeName} — {p.awayName}
                    {p.score ? ` (${p.score.home}:${p.score.away})` : ""}
                  </p>
                  <p className="text-sm text-muted">
                    {p.competitionName} · начало <Time iso={p.kickoffAt} /> · матч {p.matchStatus} ·
                    рынок {p.marketStatus} · прогнозов ждут: {p.pendingBets} · данные от{" "}
                    <Time iso={p.lastSeenAt} />
                  </p>
                  <p className="mt-1">
                    <strong>
                      {why.needsAction ? "Нужно действие: " : ""}
                      {why.title}.
                    </strong>{" "}
                    {why.detail}
                    {why.expectedAt ? (
                      <>
                        {" "}
                        Ожидается: <Time iso={why.expectedAt} />.
                      </>
                    ) : null}
                  </p>
                  {p.lastFailureAt ? (
                    <p className="text-sm">
                      Последний сбой расчета: <Time iso={p.lastFailureAt} /> (см. audit_events).
                    </p>
                  ) : null}
                  {p.reason === "RESULT_CONFLICT" ? (
                    <ResolveConflictForm matchId={p.matchId} />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="runs" className="space-y-3">
        <h2 id="runs" className="text-xl font-semibold">
          Последние запуски
        </h2>
        {o.runs.length === 0 ? (
          <p>Запусков еще не было.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {o.runs.map((r) => (
              <li
                key={r.id}
                data-testid="admin-run"
                className="flex flex-wrap gap-x-4 gap-y-1 p-3 text-sm"
              >
                <span className="font-medium">{RUN_LABEL[r.status] ?? r.status}</span>
                <Time iso={r.startedAt} />
                <span>поколение {r.generation ?? "—"}</span>
                <span>запросов {r.requests}</span>
                <span>рассчитано {r.settled}</span>
                {r.errors.length > 0 ? (
                  <span>ошибки: {r.errors.map((e) => `${e.step}: ${e.message}`).join(", ")}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-muted">
        Компенсации и разбор расхождений — по инструкции docs/runbook.md (только через SQL
        владельца).
      </p>
    </div>
  );
}
