import type { CatalogMatch } from "@/server/catalog/types";
import { KickoffTime } from "./kickoff-time";
import { acceptanceText, MARKET_STATUS_LABEL } from "./labels";

export function AcceptanceNote({
  match,
  timeZone,
}: {
  match: CatalogMatch;
  timeZone: string | null;
}) {
  const { acceptance, market } = match;
  return (
    <p className="mt-2 text-sm" data-testid="acceptance" data-reason={acceptance.reason}>
      {acceptanceText(acceptance)}
      {acceptance.reason === "OPEN" ? (
        <>
          {" "}
          <KickoffTime iso={acceptance.closesAt} timeZone={timeZone} />
        </>
      ) : null}
      {acceptance.reason === "MARKET_NOT_OPEN" && market
        ? `: рынок ${MARKET_STATUS_LABEL[market.status]}`
        : null}
    </p>
  );
}
