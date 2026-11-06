import { createHash } from "node:crypto";

/**
 * Демонстрационные коэффициенты (docs/requirements.md §7). Это игровые воспроизводимые значения,
 * не модель и не прогноз. Один и тот же матч и версия модели всегда дают одни и те же числа.
 * Итог матча в расчете не участвует.
 */

export const DEMO_MODEL_VERSION = "demo-v1";
/** Маржа «букмекера»: сумма обратных коэффициентов ≈ 1.06. */
export const DEMO_MARGIN = 1.06;
export const ODDS_MIN_MILLI = 1100;
export const ODDS_MAX_MILLI = 12000;

export interface OddsMilli {
  home: number;
  draw: number;
  away: number;
}

/** Границы вероятности, при которых коэффициент попадает в 1.10–12.00 с учетом маржи. */
const P_MIN = 1 / ((ODDS_MAX_MILLI / 1000) * DEMO_MARGIN);
const P_MAX = 1 / ((ODDS_MIN_MILLI / 1000) * DEMO_MARGIN);

/** Три числа из [0, 1) из SHA-256 ключа — детерминированно на любой платформе. */
function uniforms(key: string): [number, number, number] {
  const digest = createHash("sha256").update(key, "utf8").digest();
  const u = (offset: number) => digest.readUInt32BE(offset) / 0x1_0000_0000;
  return [u(0), u(4), u(8)];
}

/**
 * Ограничивает вероятности диапазоном [P_MIN, P_MAX], сохраняя сумму 1. За шаг исправляется
 * одна сторона: сначала слишком маленькие значения поднимаются до P_MIN, затем слишком большие
 * опускаются до P_MAX; остаток каждый раз пропорционально распределяется между незафиксированными.
 * Если сохранить сумму невозможно, возвращается null.
 */
export function clampProbabilities(
  input: readonly [number, number, number],
): [number, number, number] | null {
  if (input.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const p: number[] = [...input];
  const fixed = [false, false, false];

  for (let round = 0; round < 6; round += 1) {
    const free = [0, 1, 2].filter((i) => !fixed[i]);
    const low = free.filter((i) => (p[i] as number) < P_MIN);
    const high = free.filter((i) => (p[i] as number) > P_MAX);
    const toFix = low.length > 0 ? low : high;
    if (toFix.length === 0) break;
    for (const i of toFix) {
      p[i] = low.length > 0 ? P_MIN : P_MAX;
      fixed[i] = true;
    }
    const fixedSum = p.reduce((sum, v, i) => (fixed[i] ? sum + v : sum), 0);
    const freeSum = p.reduce((sum, v, i) => (fixed[i] ? sum : sum + v), 0);
    if (freeSum <= 0) break;
    const scale = (1 - fixedSum) / freeSum;
    for (let i = 0; i < 3; i += 1) if (!fixed[i]) p[i] = (p[i] as number) * scale;
  }

  const sum = p.reduce((a, b) => a + b, 0);
  const inRange = p.every((v) => v >= P_MIN - 1e-12 && v <= P_MAX + 1e-12);
  if (Math.abs(sum - 1) > 1e-9 || !inRange) return null;
  return [p[0] as number, p[1] as number, p[2] as number];
}

function toMilli(probability: number): number {
  // Округление вниз: коэффициент никогда не завышается относительно маржи.
  return Math.floor(1000 / (probability * DEMO_MARGIN));
}

export function isValidOdds(odds: OddsMilli): boolean {
  return [odds.home, odds.draw, odds.away].every(
    (v) => Number.isInteger(v) && v >= ODDS_MIN_MILLI && v <= ODDS_MAX_MILLI,
  );
}

/**
 * Коэффициенты матча или null, если результат некорректен (тогда рынок не открывается).
 * Ключ включает поставщика и его ID матча, а не внутренний UUID: так значения переживают
 * пересоздание БД.
 */
export function computeDemoOdds(
  provider: string,
  providerMatchId: string,
  modelVersion: string = DEMO_MODEL_VERSION,
): OddsMilli | null {
  if (!provider || !providerMatchId || !modelVersion) return null;
  const [u1, u2, u3] = uniforms(`${modelVersion}|${provider}|${providerMatchId}`);

  // Веса: хозяева в среднем чуть сильнее, ничья — реже крайних значений.
  const wHome = 0.3 + 0.4 * u1;
  const wDraw = 0.2 + 0.12 * u2;
  const wAway = 0.2 + 0.4 * u3;
  const total = wHome + wDraw + wAway;
  const clamped = clampProbabilities([wHome / total, wDraw / total, wAway / total]);
  if (!clamped) return null;
  const [pHome, pDraw, pAway] = clamped;

  const odds = { home: toMilli(pHome), draw: toMilli(pDraw), away: toMilli(pAway) };
  return isValidOdds(odds) ? odds : null;
}

/** «2350» → «2.35»: два знака, округление вниз, без чисел с плавающей точкой. */
export function formatOdds(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const hundredths = Math.floor((milli % 1000) / 10);
  return `${whole}.${String(hundredths).padStart(2, "0")}`;
}
