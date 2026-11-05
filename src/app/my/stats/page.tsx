import type { Metadata } from "next";
import Link from "next/link";
import {
  formatPercent,
  formatSigned,
  LEADERBOARD_MIN_SETTLED,
  missingForLeaderboard,
} from "@/domain/stats/stats";
import { requirePseudonym } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";
import { getMyStats, type MyStats } from "@/server/stats";

export const metadata: Metadata = { title: "Моя статистика" };
export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("ru-RU");

async function load(): Promise<MyStats | null> {
  try {
    return await getMyStats(await createClient());
  } catch {
    return null;
  }
}

function Item({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd data-testid={testId} className="text-xl font-semibold">
        {value}
      </dd>
    </div>
  );
}

export default async function MyStatsPage() {
  await requirePseudonym("/my/stats");
  const data = await load();

  if (!data) {
    return (
      <div role="alert" className="space-y-2">
        <h1 className="text-2xl font-bold">Моя статистика</h1>
        <p>Не удалось загрузить статистику. Попробуйте позже.</p>
      </div>
    );
  }

  const { stats, place } = data;
  const missing = missingForLeaderboard(stats.settled);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Моя статистика</h1>

      {stats.settled === 0 && stats.pending === 0 && stats.void === 0 ? (
        <p data-testid="stats-empty">
          Прогнозов пока нет.{" "}
          <Link href="/matches" className="underline underline-offset-4">
            Выбрать матч
          </Link>
        </p>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Item
          label="Рассчитано (выигрыш + проигрыш)"
          value={String(stats.settled)}
          testId="stats-settled"
        />
        <Item label="Выигрышей" value={String(stats.won)} testId="stats-won" />
        <Item label="Проигрышей" value={String(stats.lost)} testId="stats-lost" />
        <Item
          label="Угадано (win rate)"
          value={formatPercent(stats.winRate)}
          testId="stats-win-rate"
        />
        <Item
          label="Сумма учитываемых ставок"
          value={numberFormat.format(stats.stakes)}
          testId="stats-stakes"
        />
        <Item label="Чистый результат" value={formatSigned(stats.profit)} testId="stats-profit" />
        <Item label="ROI" value={formatPercent(stats.roi)} testId="stats-roi" />
        <Item label="Возвраты (не учитываются)" value={String(stats.void)} testId="stats-void" />
        <Item label="Ожидают результата" value={String(stats.pending)} testId="stats-pending" />
      </dl>

      <p data-testid="stats-place">
        {place
          ? `Место в рейтинге: ${place}.`
          : missing > 0
            ? `До рейтинга осталось рассчитанных прогнозов: ${missing} (нужно ${LEADERBOARD_MIN_SETTLED}).`
            : "Вас нет в рейтинге: аккаунт отключен или псевдоним не выбран."}{" "}
        <Link href="/leaderboard" className="underline underline-offset-4">
          Рейтинг
        </Link>
      </p>

      <section aria-labelledby="formulas" className="space-y-1 text-sm text-muted">
        <h2 id="formulas" className="text-base font-semibold text-fg">
          Как считается
        </h2>
        <p>Учитываются только рассчитанные прогнозы с выигрышем или проигрышем.</p>
        <p>Чистый результат = выплаты − ставки. ROI = чистый результат / ставки × 100%.</p>
        <p>Win rate = выигрыши / (выигрыши + проигрыши) × 100%. Если делить не на что — «—».</p>
        <p>
          Возвраты, ожидающие прогнозы, стартовые монеты и корректировки не влияют на статистику.
        </p>
      </section>
    </div>
  );
}
