import { describe, expect, it } from "vitest";
import { rankPlayers } from "@/domain/stats/stats";
import { DEMO_LEADERBOARD_PLAYERS } from "@/fixtures/demo-leaderboard";

describe("демо-рейтинг", () => {
  const board = rankPlayers(DEMO_LEADERBOARD_PLAYERS);

  it("показывает только допущенных и не отключенных игроков", () => {
    expect(board.map((e) => e.displayName)).toEqual([
      "Тактик_с_дивана",
      "Фанат_ничьих",
      "Осторожный",
    ]);
  });

  it("при равной прибыли выше тот, у кого больше рассчитанных", () => {
    expect(board[0]).toMatchObject({ netProfit: 280, settled: 6, stakes: 1100 });
    expect(board[1]).toMatchObject({ netProfit: 280, settled: 5, stakes: 300 });
    expect(board[2]).toMatchObject({ netProfit: -40, settled: 5 });
  });
});
