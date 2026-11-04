import Link from "next/link";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/server/auth/session";
import { getMyBalance, getMyBetForMarket } from "@/server/betting/wallet";
import type { CatalogMatch } from "@/server/catalog/types";
import { createClient } from "@/server/db/supabase-server";
import { Coupon } from "./coupon";

const OUTCOME_TEXT: Record<string, string> = {
  HOME: "победа хозяев",
  DRAW: "ничья",
  AWAY: "победа гостей",
};
const numberFormat = new Intl.NumberFormat("ru-RU");

async function loadPanelData(marketId: string, userId: string) {
  try {
    const supabase = await createClient();
    const [balance, bet] = await Promise.all([
      getMyBalance(supabase, userId),
      getMyBetForMarket(supabase, marketId),
    ]);
    return { ok: true as const, balance, bet };
  } catch {
    return { ok: false as const };
  }
}

/** Что показать под коэффициентами: купон, уже сделанный прогноз или причину, почему купона нет. */
export async function BetPanel({ match }: { match: CatalogMatch }) {
  const box = "rounded border border-border bg-surface p-3 text-sm";

  if (getEnv().APP_DATA_MODE !== "connected") {
    return (
      <p className={box} data-testid="bet-panel-demo">
        В демо-режиме прогнозы не принимаются: здесь можно посмотреть, как устроены матчи и
        коэффициенты.
      </p>
    );
  }
  if (!match.market) return null;

  const user = await getCurrentUser();
  if (!user) {
    return (
      <p className={box}>
        <Link
          href={`/login?next=${encodeURIComponent(`/matches/${match.id}`)}`}
          className="underline"
        >
          Войдите через GitHub
        </Link>
        , чтобы сделать прогноз.
      </p>
    );
  }

  const data = await loadPanelData(match.market.id, user.id);
  if (!data.ok) {
    return (
      <p role="alert" className={box}>
        Не удалось загрузить кошелек. Купон временно недоступен.
      </p>
    );
  }
  if (data.bet) {
    return (
      <p className={box} data-testid="my-bet">
        Ваш прогноз: {OUTCOME_TEXT[data.bet.outcome] ?? data.bet.outcome}, сумма{" "}
        {numberFormat.format(data.bet.stake)}, возможная выплата{" "}
        {numberFormat.format(data.bet.potentialPayout)} монет.{" "}
        <Link href="/my/bets" className="underline">
          Мои прогнозы
        </Link>
      </p>
    );
  }
  if (!match.acceptance.accepting) return null;
  if (data.balance === null) {
    return <p className={box}>Кошелек еще не готов. Выйдите и войдите снова.</p>;
  }

  return (
    <Coupon
      key={`${match.market.id}:${match.market.quoteVersion}`}
      marketId={match.market.id}
      quoteVersion={match.market.quoteVersion}
      odds={match.market.odds}
      balance={data.balance}
    />
  );
}
