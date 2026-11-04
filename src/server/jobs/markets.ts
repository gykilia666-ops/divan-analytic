import { computeDemoOdds, DEMO_MODEL_VERSION, type OddsMilli } from "@/domain/odds/demo-odds";

/** Порт хранилища рынков: в проде — SQL-функции (service_role), в тестах — подделка. */
export interface MarketStore {
  closeMarkets(): Promise<{ suspended: number; closed: number }>;
  listMatchesNeedingMarket(
    provider: string,
    limit: number,
  ): Promise<{ matchId: string; providerId: string }[]>;
  createMarkets(
    modelVersion: string,
    items: { matchId: string; odds: OddsMilli }[],
  ): Promise<number>;
}

export interface MarketSummary {
  suspended: number;
  closed: number;
  candidates: number;
  created: number;
  /** Матчи, для которых коэффициенты не прошли проверку: рынок не открыт. */
  invalidOdds: number;
}

/**
 * Обслуживание рынков после синхронизации (§10.3, шаги 8–9). Выполняется и тогда, когда
 * поставщик недоступен: закрытие по времени — локальная работа, внешний API ей не нужен.
 */
export async function maintainMarkets(options: {
  store: MarketStore;
  provider: string;
  modelVersion?: string;
  limit?: number;
}): Promise<MarketSummary> {
  const modelVersion = options.modelVersion ?? DEMO_MODEL_VERSION;
  const closed = await options.store.closeMarkets();
  const candidates = await options.store.listMatchesNeedingMarket(
    options.provider,
    options.limit ?? 200,
  );

  const items: { matchId: string; odds: OddsMilli }[] = [];
  let invalidOdds = 0;
  for (const candidate of candidates) {
    const odds = computeDemoOdds(options.provider, candidate.providerId, modelVersion);
    if (odds) items.push({ matchId: candidate.matchId, odds });
    else invalidOdds += 1;
  }

  const created = items.length > 0 ? await options.store.createMarkets(modelVersion, items) : 0;
  return { ...closed, candidates: candidates.length, created, invalidOdds };
}
