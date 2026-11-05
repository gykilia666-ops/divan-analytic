import type { Metadata } from "next";
import Link from "next/link";
import {
  formatPercent,
  formatSigned,
  missingForLeaderboard,
  type LeaderboardEntry,
} from "@/domain/stats/stats";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { createClient } from "@/server/db/supabase-server";
import { getLeaderboard, getMyStats, type LeaderboardData, type MyStats } from "@/server/stats";

export const metadata: Metadata = { title: "Рейтинг" };
export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("ru-RU");

async function loadBoard(): Promise<LeaderboardData | null> {
  try {
    return await getLeaderboard(createClient);
  } catch {
    return null;
  }
}

/** Место текущего пользователя — отдельно от общего кеша рейтинга. */
async function loadMine(): Promise<MyStats | null> {
  if (getEnv().APP_DATA_MODE !== "connected") return null;
  try {
    const user = await getCurrentUser();
    if (!user) return null;
    return await getMyStats(await createClient());
  } catch {
    return null;
  }
}

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <tr data-testid="leaderboard-row" className="border-t border-border">
      <td className="p-2 font-semibold">{entry.place}</td>
      <td className="p-2 break-all">{entry.displayName}</td>
      <td className="p-2 text-right">{entry.settled}</td>
      <td className="hidden p-2 text-right sm:table-cell">{formatPercent(entry.winRate)}</td>
      <td className="hidden p-2 text-right sm:table-cell">{formatPercent(entry.roi)}</td>
      <td className="p-2 text-right font-semibold">{formatSigned(entry.netProfit)}</td>
    </tr>
  );
}

export default async function LeaderboardPage() {
  const [board, mine] = await Promise.all([loadBoard(), loadMine()]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Рейтинг</h1>
      <p className="text-sm text-muted">
        Место определяет чистый игровой результат: выплаты минус ставки по рассчитанным прогнозам.
        Баланс, стартовые монеты и возвраты не учитываются. В рейтинг попадают игроки, у которых не
        меньше {board?.minSettled ?? 5} рассчитанных прогнозов. Обновляется раз в минуту.
      </p>

      {board?.source === "demo" ? (
        <p
          data-testid="leaderboard-demo"
          className="rounded-lg border border-border bg-surface p-3"
        >
          Демонстрационные данные: вымышленные игроки, прогнозы демо-режима сюда не попадают.
        </p>
      ) : null}

      {mine ? (
        <p
          data-testid="leaderboard-mine"
          className="rounded-lg border border-border bg-surface p-3"
        >
          {mine.place
            ? `Ваше место: ${mine.place}.`
            : `До рейтинга осталось рассчитанных прогнозов: ${missingForLeaderboard(mine.stats.settled)}.`}{" "}
          <Link href="/my/stats" className="underline underline-offset-4">
            Моя статистика
          </Link>
        </p>
      ) : null}

      {!board ? (
        <p role="alert">Рейтинг временно недоступен. Попробуйте позже.</p>
      ) : board.entries.length === 0 ? (
        <p data-testid="leaderboard-empty">
          Пока никто не набрал {board.minSettled} рассчитанных прогнозов.{" "}
          <Link href="/matches" className="underline underline-offset-4">
            Сделать прогноз
          </Link>
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Рейтинг игроков по чистому игровому результату</caption>
            <thead>
              <tr className="text-left">
                <th scope="col" className="p-2">
                  Место
                </th>
                <th scope="col" className="p-2">
                  Игрок
                </th>
                <th scope="col" className="p-2 text-right">
                  Прогнозов
                </th>
                <th scope="col" className="hidden p-2 text-right sm:table-cell">
                  Угадано
                </th>
                <th scope="col" className="hidden p-2 text-right sm:table-cell">
                  ROI
                </th>
                <th scope="col" className="p-2 text-right">
                  Результат
                </th>
              </tr>
            </thead>
            <tbody>
              {board.entries.map((entry) => (
                <Row key={entry.place} entry={entry} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Всего в таблице: {numberFormat.format(board?.entries.length ?? 0)}. Монеты ненастоящие и не
        имеют денежной стоимости.
      </p>
    </div>
  );
}
