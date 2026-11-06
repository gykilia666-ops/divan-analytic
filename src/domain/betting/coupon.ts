/**
 * Правила купона для интерфейса (docs/requirements.md §6.7). Окончательная проверка — в place_bet;
 * здесь только подсказки пользователю и предварительный расчет для отображения.
 */

export const STAKE_MIN = 10;
export const STAKE_MAX = 1000;

export type StakeCheck = { ok: true; stake: number } | { ok: false; message: string };

export function checkStake(raw: string, balance: number | null): StakeCheck {
  const value = raw.trim();
  if (!/^\d{1,7}$/.test(value)) {
    return { ok: false, message: "Введите целое число монет." };
  }
  const stake = Number(value);
  if (stake < STAKE_MIN) return { ok: false, message: `Минимум ${STAKE_MIN} монет.` };
  if (stake > STAKE_MAX) return { ok: false, message: `Максимум ${STAKE_MAX} монет.` };
  if (balance !== null && stake > balance) {
    return { ok: false, message: "Недостаточно монет на балансе." };
  }
  return { ok: true, stake };
}

/** floor(stake × odds_milli / 1000) — целочисленно, как в БД; включает сумму прогноза. */
export function potentialPayout(stake: number, oddsMilli: number): number {
  return Math.floor((stake * oddsMilli) / 1000);
}
