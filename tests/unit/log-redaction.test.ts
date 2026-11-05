import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, sanitizeLogValue } from "@/server/observability/log";

describe("sanitizeLogValue", () => {
  it("скрывает значения чувствительных полей на любой глубине", () => {
    const out = sanitizeLogValue({
      authorization: "Bearer abc",
      nested: { serviceRoleKey: "x", cookie: "sb=1", apiKey: "k", ok: 1 },
      userEmail: "a@b.co",
    });
    expect(out).toEqual({
      authorization: "[redacted]",
      nested: { serviceRoleKey: "[redacted]", cookie: "[redacted]", apiKey: "[redacted]", ok: 1 },
      userEmail: "[redacted]",
    });
  });

  it("вычищает bearer-токены, JWT и email внутри строк", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3OCJ9.c2lnbmF0dXJlLXZhbHVl";
    expect(sanitizeLogValue(`failed: Bearer s3cr3t-value for user@mail.ru, ${jwt}`)).toBe(
      "failed: Bearer [redacted] for [redacted-email], [redacted-jwt]",
    );
  });

  it("обрезает длинные строки и глубокие объекты", () => {
    expect(String(sanitizeLogValue("x".repeat(1000))).length).toBe(301);
    expect(sanitizeLogValue({ a: { b: { c: { d: { e: 1 } } } } })).toEqual({
      a: { b: { c: { d: "[truncated]" } } },
    });
  });

  it("не трогает обычные служебные поля", () => {
    expect(sanitizeLogValue({ requestId: "r1", jobId: "sync", errorCode: "TIMEOUT" })).toEqual({
      requestId: "r1",
      jobId: "sync",
      errorCode: "TIMEOUT",
    });
  });
});

describe("logEvent", () => {
  afterEach(() => vi.restoreAllMocks());

  it("пишет JSON без секретов", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logEvent({ event: "test", requestId: "r", token: "t0p", message: "Bearer abc.def" });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain("t0p");
    expect(line).not.toContain("abc.def");
    expect(JSON.parse(line)).toMatchObject({ event: "test", level: "info", token: "[redacted]" });
  });
});
