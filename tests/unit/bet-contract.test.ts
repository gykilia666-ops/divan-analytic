import { describe, expect, it } from "vitest";
import {
  betCommandSchema,
  errorResponseFor,
  placeBetResultSchema,
} from "@/server/betting/contract";

const valid = {
  marketId: "0b6f2f0e-1111-4222-8333-944444444444",
  outcome: "HOME",
  stake: 100,
  quoteVersion: 1,
  idempotencyKey: "1b6f2f0e-1111-4222-8333-944444444444",
};

describe("betCommandSchema", () => {
  it("корректная команда", () => {
    expect(betCommandSchema.safeParse(valid).success).toBe(true);
  });
  it("клиентские userId, odds, payout, balance не принимаются", () => {
    for (const extra of [
      { userId: "x" },
      { odds: 9000 },
      { potentialPayout: 1 },
      { balance: 1e9 },
    ]) {
      expect(betCommandSchema.safeParse({ ...valid, ...extra }).success).toBe(false);
    }
  });
  it("некорректные значения", () => {
    for (const bad of [
      { stake: 9 },
      { stake: 1001 },
      { stake: 10.5 },
      { stake: "100" },
      { outcome: "X" },
      { quoteVersion: 0 },
      { marketId: "nope" },
      { idempotencyKey: "nope" },
    ]) {
      expect(betCommandSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });
});

describe("placeBetResultSchema", () => {
  it("успех и отказ", () => {
    expect(
      placeBetResultSchema.safeParse({
        ok: true,
        replay: false,
        balance: 9900,
        bet: {
          id: "b",
          marketId: "m",
          outcome: "HOME",
          stake: 100,
          acceptedOddsMilli: 2350,
          potentialPayout: 235,
          status: "PENDING",
          createdAt: "2026-11-05T10:00:00+00:00",
        },
      }).success,
    ).toBe(true);
    expect(
      placeBetResultSchema.safeParse({ ok: false, code: "MARKET_CLOSED", details: {} }).success,
    ).toBe(true);
  });
});

describe("errorResponseFor", () => {
  it("коды по контракту §11.2", () => {
    expect(errorResponseFor("QUOTE_CHANGED").status).toBe(409);
    expect(errorResponseFor("INSUFFICIENT_BALANCE").status).toBe(422);
    expect(errorResponseFor("RATE_LIMITED").status).toBe(429);
    expect(errorResponseFor("DATA_STALE").status).toBe(503);
    expect(errorResponseFor("UNAUTHENTICATED").status).toBe(401);
    expect(errorResponseFor("PSEUDONYM_REQUIRED").status).toBe(403);
  });
  it("неизвестный код не раскрывается клиенту", () => {
    expect(errorResponseFor("SOMETHING_INTERNAL")).toEqual({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Сервис временно недоступен",
    });
  });
});
