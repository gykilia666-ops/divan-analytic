import type { RankablePlayer, StatsBet } from "@/domain/stats/stats";

/**
 * Вымышленные игроки для демо-рейтинга (CLAUDE.md §15). Не реальные пользователи и не данные БД.
 * Набор покрывает правила: допуск от 5 рассчитанных, VOID/PENDING не считаются, отключенный
 * профиль скрыт, равная прибыль — выше тот, у кого больше рассчитанных прогнозов.
 */
function won(stake: number, oddsMilli: number): StatsBet {
  return { status: "WON", stake, actualPayout: Math.floor((stake * oddsMilli) / 1000) };
}
function lost(stake: number): StatsBet {
  return { status: "LOST", stake, actualPayout: 0 };
}
function refunded(stake: number): StatsBet {
  return { status: "VOID", stake, actualPayout: stake };
}
function pending(stake: number): StatsBet {
  return { status: "PENDING", stake, actualPayout: null };
}

export const DEMO_LEADERBOARD_PLAYERS: readonly RankablePlayer[] = [
  {
    id: "demo-p1",
    displayName: "Тактик_с_дивана",
    avatarUrl: null,
    // +300 +250 −100 −200 +180 −150 = +280 при ставках 1100; возврат не учитывается
    bets: [
      won(300, 2000),
      won(250, 2000),
      lost(100),
      lost(200),
      won(100, 2800),
      lost(150),
      refunded(100),
    ],
  },
  {
    id: "demo-p2",
    displayName: "Фанат_ничьих",
    avatarUrl: null,
    // +240 +140 −50 −30 −20 = +280 при 5 рассчитанных → ниже demo-p1 (там 6)
    bets: [won(100, 3400), won(100, 2400), lost(50), lost(30), lost(20), pending(200)],
  },
  {
    id: "demo-p3",
    displayName: "Осторожный",
    avatarUrl: null,
    // 5 рассчитанных: +50 +40 −50 −50 −30 = −40
    bets: [won(100, 1500), won(100, 1400), lost(50), lost(50), lost(30)],
  },
  {
    id: "demo-p4",
    displayName: "Новичок",
    avatarUrl: null,
    // 4 рассчитанных — пока не в рейтинге, хотя прибыль лучшая
    bets: [won(500, 3000), won(500, 3000), lost(10), lost(10), pending(100)],
  },
  {
    id: "demo-p5",
    displayName: "Скрытый",
    avatarUrl: null,
    disabled: true,
    bets: [won(500, 4000), won(500, 4000), won(500, 4000), won(500, 4000), won(500, 4000)],
  },
];
