import { describe, expect, it } from "vitest";
import { explainWait, WAIT_REASONS } from "@/domain/admin/wait-reason";

const kickoffAt = "2026-11-05T12:00:00.000Z";

describe("explainWait", () => {
  it("объясняет каждую причину", () => {
    for (const reason of WAIT_REASONS) {
      const e = explainWait({ reason, kickoffAt, resultFirstSeenAt: null });
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.detail.length).toBeGreaterThan(0);
    }
  });

  it("требует действия только при конфликте и неоднозначном итоге", () => {
    const needs = WAIT_REASONS.filter(
      (reason) => explainWait({ reason, kickoffAt, resultFirstSeenAt: null }).needsAction,
    );
    expect(needs).toEqual(["RESULT_CONFLICT", "AMBIGUOUS_RESULT"]);
  });

  it("подтверждение ожидается через 10 минут после первого наблюдения", () => {
    const e = explainWait({
      reason: "AWAITING_CONFIRMATION",
      kickoffAt,
      resultFirstSeenAt: "2026-11-05T14:00:00.000Z",
    });
    expect(e.expectedAt).toBe("2026-11-05T14:10:00.000Z");
    expect(
      explainWait({ reason: "AWAITING_CONFIRMATION", kickoffAt, resultFirstSeenAt: null })
        .expectedAt,
    ).toBeNull();
  });

  it("прерванный матч аннулируется через 48 часов от начала", () => {
    expect(
      explainWait({ reason: "SUSPENDED_WAIT", kickoffAt, resultFirstSeenAt: null }).expectedAt,
    ).toBe("2026-11-07T12:00:00.000Z");
  });
});
