import { describe, expect, it } from "vitest";
import { checkStake, potentialPayout } from "@/domain/betting/coupon";

describe("checkStake", () => {
  it("допустимая сумма", () => {
    expect(checkStake("100", 10_000)).toEqual({ ok: true, stake: 100 });
    expect(checkStake(" 10 ", null)).toEqual({ ok: true, stake: 10 });
    expect(checkStake("1000", 1000)).toEqual({ ok: true, stake: 1000 });
  });
  it("границы и формат", () => {
    expect(checkStake("9", 10_000).ok).toBe(false);
    expect(checkStake("1001", 10_000).ok).toBe(false);
    expect(checkStake("10.5", 10_000).ok).toBe(false);
    expect(checkStake("-10", 10_000).ok).toBe(false);
    expect(checkStake("", 10_000).ok).toBe(false);
    expect(checkStake("1e3", 10_000).ok).toBe(false);
  });
  it("больше баланса", () => {
    const r = checkStake("500", 499);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).toContain("Недостаточно");
  });
});

describe("potentialPayout", () => {
  it("округление вниз и включение суммы", () => {
    expect(potentialPayout(100, 2350)).toBe(235);
    expect(potentialPayout(50, 4001)).toBe(200);
    expect(potentialPayout(10, 1100)).toBe(11);
    expect(potentialPayout(1000, 12000)).toBe(12000);
    expect(potentialPayout(33, 1999)).toBe(65);
  });
});
