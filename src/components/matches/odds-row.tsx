import { formatOdds } from "@/domain/odds/demo-odds";
import type { CatalogMarket } from "@/server/catalog/types";
import { OUTCOME_LABEL } from "./labels";

export function OddsRow({ market, dimmed }: { market: CatalogMarket; dimmed: boolean }) {
  const outcomes = ["home", "draw", "away"] as const;
  return (
    <dl
      className={`mt-3 grid grid-cols-3 gap-2 text-center ${dimmed ? "opacity-70" : ""}`}
      aria-label="Демонстрационные коэффициенты"
    >
      {outcomes.map((key) => (
        <div key={key} className="rounded-lg border border-border px-2 py-1">
          <dt className="text-xs text-muted">
            <span aria-hidden="true">{OUTCOME_LABEL[key].short}</span>
            <span className="sr-only">{OUTCOME_LABEL[key].long}</span>
          </dt>
          <dd className="font-semibold tabular-nums" data-testid={`odds-${key}`}>
            {formatOdds(market.odds[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}
