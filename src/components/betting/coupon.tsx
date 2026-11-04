"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { checkStake, potentialPayout, STAKE_MAX, STAKE_MIN } from "@/domain/betting/coupon";

type Outcome = "HOME" | "DRAW" | "AWAY";

const OUTCOMES: { value: Outcome; label: string; short: string }[] = [
  { value: "HOME", label: "Победа хозяев", short: "1" },
  { value: "DRAW", label: "Ничья", short: "X" },
  { value: "AWAY", label: "Победа гостей", short: "2" },
];

function formatOdds(milli: number): string {
  return `${Math.floor(milli / 1000)}.${String(Math.floor((milli % 1000) / 10)).padStart(2, "0")}`;
}

const numberFormat = new Intl.NumberFormat("ru-RU");

type Placed = { outcome: Outcome; stake: number; potentialPayout: number; balance: number | null };

/**
 * Купон. Кнопка блокируется на время запроса, но защита от двойного списания — на сервере:
 * один ключ идемпотентности на одно намерение. Повтор после сетевой ошибки использует тот же ключ;
 * изменение исхода или суммы — новое намерение и новый ключ.
 */
export function Coupon({
  marketId,
  quoteVersion,
  odds,
  balance,
}: {
  marketId: string;
  quoteVersion: number;
  odds: { home: number; draw: number; away: number };
  balance: number;
}) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [stakeRaw, setStakeRaw] = useState("100");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);
  const keyRef = useRef<string | null>(null);

  const stake = checkStake(stakeRaw, balance);
  const selectedOdds =
    outcome === "HOME"
      ? odds.home
      : outcome === "DRAW"
        ? odds.draw
        : outcome === "AWAY"
          ? odds.away
          : null;

  function newIntent() {
    keyRef.current = null;
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !outcome || !stake.ok) return;
    keyRef.current ??= crypto.randomUUID();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          marketId,
          outcome,
          stake: stake.stake,
          quoteVersion,
          idempotencyKey: keyRef.current,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: {
              bet: { potentialPayout: number; stake: number; outcome: Outcome };
              balance: number | null;
            };
          }
        | { error?: { code: string; message: string } }
        | null;

      if (res.ok && body && "data" in body && body.data) {
        setPlaced({
          outcome: body.data.bet.outcome,
          stake: body.data.bet.stake,
          potentialPayout: body.data.bet.potentialPayout,
          balance: body.data.balance,
        });
        router.refresh();
        return;
      }
      const err = body && "error" in body && body.error ? body.error : null;
      setError(err ?? { code: "SERVICE_UNAVAILABLE", message: "Сервис временно недоступен" });
      // Отказ по существу (не сетевой сбой) завершает это намерение.
      if (err && err.code !== "SERVICE_UNAVAILABLE") keyRef.current = null;
    } catch {
      // Ответ не получен: результат неизвестен. Ключ сохраняется — повтор не спишет дважды.
      setError({
        code: "NETWORK",
        message: "Нет ответа от сервера. Нажмите «Подтвердить» еще раз — повтор безопасен.",
      });
    } finally {
      setPending(false);
    }
  }

  if (placed) {
    const label = OUTCOMES.find((o) => o.value === placed.outcome)?.label ?? placed.outcome;
    return (
      <div
        role="status"
        className="rounded border border-border bg-surface p-4"
        data-testid="coupon-success"
      >
        <p className="font-semibold">Прогноз принят: {label}</p>
        <p className="text-sm">
          Сумма {numberFormat.format(placed.stake)}, возможная выплата{" "}
          {numberFormat.format(placed.potentialPayout)} монет (включая сумму прогноза).
        </p>
        {placed.balance !== null ? (
          <p className="text-sm text-muted">Баланс: {numberFormat.format(placed.balance)} монет.</p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded border border-border bg-surface p-4"
      aria-label="Купон"
    >
      <fieldset>
        <legend className="mb-2 font-semibold">Ваш прогноз</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {OUTCOMES.map((o) => {
            const value =
              o.value === "HOME" ? odds.home : o.value === "DRAW" ? odds.draw : odds.away;
            return (
              <label
                key={o.value}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded border px-3 py-2 ${
                  outcome === o.value ? "border-accent font-semibold" : "border-border"
                }`}
              >
                <span>
                  <input
                    type="radio"
                    name="outcome"
                    value={o.value}
                    checked={outcome === o.value}
                    onChange={() => {
                      setOutcome(o.value);
                      newIntent();
                    }}
                    className="mr-2"
                  />
                  {o.label} ({o.short})
                </span>
                <span className="tabular-nums">{formatOdds(value)}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="stake" className="text-sm">
          Сумма, монет ({STAKE_MIN}–{STAKE_MAX}; на балансе {numberFormat.format(balance)})
        </label>
        <input
          id="stake"
          name="stake"
          inputMode="numeric"
          value={stakeRaw}
          onChange={(e) => {
            setStakeRaw(e.target.value);
            newIntent();
          }}
          aria-invalid={!stake.ok}
          aria-describedby="stake-help"
          className="w-40 rounded border border-border bg-surface px-2 py-1"
        />
        <p id="stake-help" className="text-sm" data-testid="stake-help">
          {!stake.ok
            ? stake.message
            : selectedOdds !== null
              ? `Возможная выплата: ${numberFormat.format(potentialPayout(stake.stake, selectedOdds))} монет — включает сумму прогноза.`
              : "Выберите исход."}
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded border border-border bg-warn-bg p-2 text-sm text-warn-fg"
          data-testid="coupon-error"
        >
          {error.message}
          {error.code === "QUOTE_CHANGED" ? (
            <>
              {" "}
              <button type="button" className="underline" onClick={() => router.refresh()}>
                Обновить коэффициенты
              </button>
            </>
          ) : null}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !outcome || !stake.ok}
        className="rounded bg-accent px-4 py-2 font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Отправляем…" : "Подтвердить прогноз"}
      </button>
      <p className="text-xs text-muted">Принятый прогноз отменить нельзя. Монеты ненастоящие.</p>
    </form>
  );
}
