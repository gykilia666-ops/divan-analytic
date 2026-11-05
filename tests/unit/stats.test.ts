import { describe, expect, it } from "vitest";
import {
  aggregateBets,
  emptyTotals,
  entryFromAggregates,
  formatPercent,
  formatSigned,
  missingForLeaderboard,
  rankPlayers,
  summarize,
  type RankablePlayer,
  type StatsBet,
} from "@/domain/stats/stats";

const W = (stake: number, payout: number): StatsBet => ({
  status: "WON",
  stake,
  actualPayout: payout,
});
const L = (stake: number): StatsBet => ({ status: "LOST", stake, actualPayout: 0 });
const V = (stake: number): StatsBet => ({ status: "VOID", stake, actualPayout: stake });
const P = (stake: number): StatsBet => ({ status: "PENDING", stake, actualPayout: null });

describe("aggregateBets / summarize", () => {
  it("считает только WON и LOST; VOID и PENDING — отдельно", () => {
    const s = summarize(aggregateBets([W(100, 200), W(100, 250), L(100), V(500), P(300)]));
    expect(s).toMatchObject({ won: 2, lost: 1, void: 1, pending: 1, settled: 3 });
    expect(s.stakes).toBe(300);
    expect(s.payouts).toBe(450);
    expect(s.profit).toBe(150);
    expect(s.winRate).toBeCloseTo(66.6667, 3);
    expect(s.roi).toBeCloseTo(50, 6);
  });

  it("нулевой знаменатель: win rate и ROI = null", () => {
    const s = summarize(emptyTotals());
    expect(s).toMatchObject({ settled: 0, profit: 0, winRate: null, roi: null });
    const onlyVoid = summarize(aggregateBets([V(100), P(50)]));
    expect(onlyVoid.winRate).toBeNull();
    expect(onlyVoid.roi).toBeNull();
    expect(onlyVoid.profit).toBe(0);
  });

  it("все проигрыши: ROI −100%, win rate 0%", () => {
    const s = summarize(aggregateBets([L(100), L(50)]));
    expect(s.winRate).toBe(0);
    expect(s.roi).toBe(-100);
    expect(s.profit).toBe(-150);
  });
});

describe("форматирование", () => {
  it("проценты: одна цифра, «—» для null, без −0", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(66.6667)).toBe("66,7 %");
    expect(formatPercent(-100)).toBe("−100,0 %");
    expect(formatPercent(-0.04)).toBe("0,0 %");
  });

  it("числа со знаком", () => {
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(1500)).toMatch(/^\+1\s500$/);
    expect(formatSigned(-300)).toBe("−300");
  });

  it("допуск к рейтингу", () => {
    expect(missingForLeaderboard(0)).toBe(5);
    expect(missingForLeaderboard(4)).toBe(1);
    expect(missingForLeaderboard(5)).toBe(0);
    expect(missingForLeaderboard(9)).toBe(0);
  });
});

describe("rankPlayers", () => {
  const five = (profitPerWin: number): StatsBet[] => [
    W(100, 100 + profitPerWin),
    L(10),
    L(10),
    L(10),
    L(10),
  ];
  const player = (id: string, bets: StatsBet[], disabled = false): RankablePlayer => ({
    id,
    displayName: `Игрок ${id}`,
    avatarUrl: null,
    disabled,
    bets,
  });

  it("допуск от 5 рассчитанных, VOID/PENDING не считаются, отключенные скрыты", () => {
    const board = rankPlayers([
      player("a", five(100)),
      player("b", [W(100, 900), W(100, 900), W(100, 900), W(100, 900), V(10), P(10)]),
      player("c", five(500), true),
    ]);
    expect(board.map((e) => e.displayName)).toEqual(["Игрок a"]);
  });

  it("сортировка: прибыль ↓, рассчитано ↓, затем стабильный id", () => {
    const sixWithSameProfit = [...five(100), L(0 + 10)].map((b, i) => (i === 0 ? W(100, 210) : b));
    const board = rankPlayers([
      player("z", five(60)),
      player("y", five(60)),
      player("x", sixWithSameProfit),
      player("w", five(500)),
    ]);
    expect(board.map((e) => [e.place, e.displayName, e.netProfit, e.settled])).toEqual([
      [1, "Игрок w", 460, 5],
      [2, "Игрок x", 60, 6],
      [3, "Игрок y", 20, 5],
      [4, "Игрок z", 20, 5],
    ]);
  });

  it("результат не содержит технический id", () => {
    const [entry] = rankPlayers([{ ...player("secret-id", five(100)), displayName: "Аноним" }]);
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {})).not.toContain("id");
    expect(JSON.stringify(entry)).not.toContain("secret-id");
  });
});

describe("entryFromAggregates", () => {
  it("те же формулы, что summarize", () => {
    const bets = [W(100, 250), L(100), L(50), W(200, 400), L(30)];
    const s = summarize(aggregateBets(bets));
    const e = entryFromAggregates({
      place: 1,
      displayName: "x",
      avatarUrl: null,
      settled: s.settled,
      won: s.won,
      stakes: s.stakes,
      netProfit: s.profit,
    });
    expect(e.winRate).toBe(s.winRate);
    expect(e.roi).toBe(s.roi);
  });
});
