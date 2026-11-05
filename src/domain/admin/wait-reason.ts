/**
 * Причины, по которым рынок еще не рассчитан (CLAUDE.md §10.6, §10.7, ADR-042…044). Коды вычисляет
 * БД (settlement_wait_reason); здесь — понятное администратору объяснение и следующий шаг.
 */
export const WAIT_REASONS = [
  "RESULT_CONFLICT",
  "MARKET_NOT_CLOSED",
  "NOT_FINISHED",
  "SUSPENDED_WAIT",
  "AMBIGUOUS_RESULT",
  "NO_RESULT_DATA",
  "AWAITING_CONFIRMATION",
  "READY",
] as const;
export type WaitReason = (typeof WAIT_REASONS)[number];

/** Интервал подтверждения итога (ADR-042) и порог аннулирования приостановленного матча (ADR-043). */
export const CONFIRMATION_INTERVAL_MS = 10 * 60 * 1000;
export const SUSPENDED_VOID_AFTER_MS = 48 * 60 * 60 * 1000;

export interface WaitContext {
  reason: WaitReason;
  kickoffAt: string;
  resultFirstSeenAt: string | null;
}

export interface WaitExplanation {
  title: string;
  detail: string;
  /** Когда ожидание закончится само (ISO), если это известно. */
  expectedAt: string | null;
  /** Нужен ли человек: без него рынок не рассчитается. */
  needsAction: boolean;
}

function plus(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function explainWait(ctx: WaitContext): WaitExplanation {
  switch (ctx.reason) {
    case "RESULT_CONFLICT":
      return {
        title: "Итог изменился после расчета",
        detail:
          "Автоматика по матчу на паузе. Сверьте итог; при необходимости компенсируйте и примите итог.",
        expectedAt: null,
        needsAction: true,
      };
    case "MARKET_NOT_CLOSED":
      return {
        title: "Рынок еще открыт",
        detail: "Матч начался, рынок закроет следующий запуск синхронизации.",
        expectedAt: null,
        needsAction: false,
      };
    case "NOT_FINISHED":
      return {
        title: "Матч еще не завершен",
        detail: "Поставщик не сообщил итог. Если матч давно должен закончиться — проверьте данные.",
        expectedAt: null,
        needsAction: false,
      };
    case "SUSPENDED_WAIT":
      return {
        title: "Матч прерван",
        detail: "Ждем возобновления; без итога через 48 ч от начала ставки вернутся.",
        expectedAt: plus(ctx.kickoffAt, SUSPENDED_VOID_AFTER_MS),
        needsAction: false,
      };
    case "AMBIGUOUS_RESULT":
      return {
        title: "Итог неоднозначен",
        detail: "Автоматический расчет не выполняется — нужна ручная проверка.",
        expectedAt: null,
        needsAction: true,
      };
    case "NO_RESULT_DATA":
      return {
        title: "Нет счета основного времени",
        detail: "Матч завершен, но счет не получен. Повторная синхронизация может его подтянуть.",
        expectedAt: null,
        needsAction: false,
      };
    case "AWAITING_CONFIRMATION":
      return {
        title: "Итог ждет подтверждения",
        detail:
          "Итог засчитывается после второго такого же наблюдения не раньше чем через 10 минут.",
        expectedAt: ctx.resultFirstSeenAt
          ? plus(ctx.resultFirstSeenAt, CONFIRMATION_INTERVAL_MS)
          : null,
        needsAction: false,
      };
    case "READY":
      return {
        title: "Готов к расчету",
        detail: "Рассчитается в ближайшем запуске задания.",
        expectedAt: null,
        needsAction: false,
      };
  }
}
