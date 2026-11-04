import { describe, expect, it } from "vitest";
import {
  clampProbabilities,
  computeDemoOdds,
  DEMO_MODEL_VERSION,
  formatOdds,
  isValidOdds,
  ODDS_MAX_MILLI,
  ODDS_MIN_MILLI,
} from "@/domain/odds/demo-odds";

const overround = (o: { home: number; draw: number; away: number }) =>
  1000 / o.home + 1000 / o.draw + 1000 / o.away;

describe("computeDemoOdds", () => {
  it("детерминирован: одинаковый матч и версия → одинаковые коэффициенты", () => {
    const a = computeDemoOdds("football-data", "560634");
    const b = computeDemoOdds("football-data", "560634", DEMO_MODEL_VERSION);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
  });

  it("зафиксированное значение не меняется между версиями кода", () => {
    // Если этот тест упал, поменялся алгоритм: нужна новая model_version, а не правка теста.
    expect(computeDemoOdds("fixtures", "demo-001")).toEqual({ home: 1839, draw: 4527, away: 3385 });
    expect(computeDemoOdds("football-data", "560634")).toEqual({
      home: 1836,
      draw: 4345,
      away: 3503,
    });
  });

  it("разные матчи, поставщики и версии модели дают разные значения", () => {
    const base = computeDemoOdds("football-data", "560634");
    expect(computeDemoOdds("football-data", "560612")).not.toEqual(base);
    expect(computeDemoOdds("fixtures", "560634")).not.toEqual(base);
    expect(computeDemoOdds("football-data", "560634", "demo-v2")).not.toEqual(base);
  });

  it("на 5000 матчах: целые значения в 1.10–12.00 и маржа около 6%", () => {
    for (let i = 0; i < 5000; i += 1) {
      const odds = computeDemoOdds("football-data", String(500000 + i));
      expect(odds, `match ${i}`).not.toBeNull();
      expect(isValidOdds(odds!)).toBe(true);
      const o = overround(odds!);
      expect(o >= 1.06 && o < 1.075, `overround ${o}`).toBe(true);
    }
  });

  it("пустой ключ не открывает рынок", () => {
    expect(computeDemoOdds("", "1")).toBeNull();
    expect(computeDemoOdds("football-data", "")).toBeNull();
    expect(computeDemoOdds("football-data", "1", "")).toBeNull();
  });
});

describe("clampProbabilities", () => {
  it("крайние значения ограничиваются, сумма остается 1, коэффициенты в диапазоне", () => {
    for (const input of [
      [0.98, 0.015, 0.005],
      [0.005, 0.015, 0.98],
      [0.9, 0.09, 0.01],
      [0.34, 0.33, 0.33],
    ] as const) {
      const p = clampProbabilities(input);
      expect(p, String(input)).not.toBeNull();
      const sum = p![0] + p![1] + p![2];
      expect(Math.abs(sum - 1) < 1e-9, `sum ${sum}`).toBe(true);
      for (const v of p!) {
        const odds = Math.floor(1000 / (v * 1.06));
        expect(odds >= ODDS_MIN_MILLI && odds <= ODDS_MAX_MILLI, `odds ${odds}`).toBe(true);
      }
    }
  });

  it("допустимые значения не меняются", () => {
    expect(clampProbabilities([0.5, 0.3, 0.2])).toEqual([0.5, 0.3, 0.2]);
  });

  it("некорректный ввод — null", () => {
    expect(clampProbabilities([0.5, 0.5, 0])).toBeNull();
    expect(clampProbabilities([Number.NaN, 0.5, 0.5])).toBeNull();
  });
});

describe("isValidOdds", () => {
  it("границы диапазона", () => {
    expect(isValidOdds({ home: 1100, draw: 12000, away: 2000 })).toBe(true);
    expect(isValidOdds({ home: 1099, draw: 2000, away: 2000 })).toBe(false);
    expect(isValidOdds({ home: 2000, draw: 12001, away: 2000 })).toBe(false);
    expect(isValidOdds({ home: 2000.5, draw: 2000, away: 2000 })).toBe(false);
  });
});

describe("formatOdds", () => {
  it("два знака, округление вниз", () => {
    expect(formatOdds(2350)).toBe("2.35");
    expect(formatOdds(2359)).toBe("2.35");
    expect(formatOdds(1100)).toBe("1.10");
    expect(formatOdds(12000)).toBe("12.00");
    expect(formatOdds(3105)).toBe("3.10");
  });
});
