import type { Metadata } from "next";
import Link from "next/link";
import { KickoffTime } from "@/components/matches/kickoff-time";
import { formatOdds } from "@/domain/odds/demo-odds";
import { requireUser } from "@/server/auth/session";
import { BET_STATUSES, getMyBets, parseBetStatus, type BetStatus } from "@/server/betting/history";
import { decodeCursor } from "@/server/catalog/cursor";
import { createClient } from "@/server/db/supabase-server";

export const metadata: Metadata = { title: "Мои прогнозы" };
export const dynamic = "force-dynamic";

// Статус передается текстом, а не только цветом.
const STATUS_LABEL: Record<BetStatus, string> = {
  PENDING: "Ожидает результата",
  WON: "Выигрыш",
  LOST: "Проигрыш",
  VOID: "Возврат",
};
const OUTCOME_LABEL = { HOME: "Победа хозяев (1)", DRAW: "Ничья (X)", AWAY: "Победа гостей (2)" };
const numberFormat = new Intl.NumberFormat("ru-RU");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function load(status: BetStatus | null, cursor: string | null) {
  try {
    return {
      ok: true as const,
      page: await getMyBets(await createClient(), { status, cursor, limit: 20 }),
    };
  } catch {
    return { ok: false as const };
  }
}

export default async function MyBetsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser("/my/bets");
  const params = await searchParams;
  const status = parseBetStatus(params.status);
  const rawCursor = typeof params.cursor === "string" ? params.cursor : null;
  const cursor = decodeCursor(rawCursor) ? rawCursor : null;
  const result = await load(status, cursor);

  const filters: { value: BetStatus | null; label: string }[] = [
    { value: null, label: "Все" },
    ...BET_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Мои прогнозы</h1>
      <nav aria-label="Фильтр по статусу">
        <ul className="flex flex-wrap gap-2 text-sm">
          {filters.map((f) => (
            <li key={f.label}>
              <Link
                href={f.value ? `/my/bets?status=${f.value}` : "/my/bets"}
                aria-current={f.value === status ? "page" : undefined}
                className={`rounded border px-2 py-1 ${f.value === status ? "border-accent font-semibold" : "border-border"}`}
              >
                {f.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!result.ok ? (
        <p role="alert" className="rounded border border-border bg-warn-bg p-3 text-warn-fg">
          Не удалось загрузить прогнозы. Попробуйте позже.
        </p>
      ) : result.page.items.length === 0 ? (
        <p className="rounded border border-border bg-surface p-4" data-testid="bets-empty">
          Прогнозов пока нет.{" "}
          <Link href="/matches" className="underline">
            Посмотреть матчи
          </Link>
        </p>
      ) : (
        <ul className="space-y-3">
          {result.page.items.map((bet) => (
            <li
              key={bet.id}
              className="rounded border border-border bg-surface p-4"
              data-testid="bet-item"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
                <span>{bet.match.competition}</span>
                <span className="rounded border border-border px-2 py-0.5 font-medium text-fg">
                  {STATUS_LABEL[bet.status]}
                </span>
              </div>
              <p className="mt-1 font-semibold">
                <Link
                  href={`/matches/${bet.match.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  {bet.match.home} — {bet.match.away}
                </Link>
              </p>
              <p className="text-sm text-muted">
                Начало: <KickoffTime iso={bet.match.kickoffAt} />
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-sm">
                <dt className="text-muted">Исход</dt>
                <dd>{OUTCOME_LABEL[bet.outcome]}</dd>
                <dt className="text-muted">Сумма</dt>
                <dd>{numberFormat.format(bet.stake)}</dd>
                <dt className="text-muted">Коэффициент</dt>
                <dd>{formatOdds(bet.acceptedOddsMilli)}</dd>
                <dt className="text-muted">Возможная выплата</dt>
                <dd>{numberFormat.format(bet.potentialPayout)}</dd>
                <dt className="text-muted">Фактическая выплата</dt>
                <dd>{bet.actualPayout === null ? "—" : numberFormat.format(bet.actualPayout)}</dd>
                <dt className="text-muted">Сделан</dt>
                <dd>
                  <KickoffTime iso={bet.createdAt} />
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}

      {result.ok && result.page.nextCursor ? (
        <Link
          href={`/my/bets?${new URLSearchParams({ ...(status ? { status } : {}), cursor: result.page.nextCursor })}`}
          className="underline"
        >
          Более ранние прогнозы →
        </Link>
      ) : null}
    </div>
  );
}
