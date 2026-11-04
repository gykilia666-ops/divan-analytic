import { describe, expect, it } from "vitest";
import { FootballDataClient, parseRetryAfter } from "@/server/providers/football-data/client";
import { ProviderError } from "@/server/providers/types";

const TOKEN = "secret-token-should-never-leak";

function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

async function caught(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw error;
  }
  throw new Error("ожидалась ошибка поставщика");
}

describe("parseRetryAfter", () => {
  it("Retry-After в секундах", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "42" }))).toBe(42);
  });
  it("Retry-After как HTTP-дата", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(
      parseRetryAfter(new Headers({ "retry-after": "Wed, 04 Nov 2026 10:00:30 GMT" }), now),
    ).toBe(30);
  });
  it("без Retry-After используется X-RequestCounter-Reset football-data", () => {
    expect(parseRetryAfter(new Headers({ "x-requestcounter-reset": "59" }))).toBe(59);
  });
  it("ничего нет — null", () => {
    expect(parseRetryAfter(new Headers())).toBeNull();
  });
});

describe("FootballDataClient", () => {
  it("отправляет токен только в заголовке и разбирает JSON", async () => {
    const { impl, calls } = fakeFetch(async () => new Response('{"ok":true}', { status: 200 }));
    const client = new FootballDataClient({ token: TOKEN, fetchImpl: impl });
    expect(await client.getJson("/competitions")).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("https://api.football-data.org/v4/competitions");
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect((calls[0]?.init.headers as Record<string, string>)["X-Auth-Token"]).toBe(TOKEN);
  });

  it("429 → RATE_LIMITED с временем ожидания", async () => {
    const { impl } = fakeFetch(
      async () => new Response("{}", { status: 429, headers: { "x-requestcounter-reset": "37" } }),
    );
    const error = await caught(
      new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
    );
    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(37);
    expect(error.transient).toBe(false);
  });

  it("401 и 403 — ошибки настройки, не временные", async () => {
    for (const [status, kind] of [
      [401, "UNAUTHORIZED"],
      [403, "FORBIDDEN"],
    ] as const) {
      const { impl } = fakeFetch(async () => new Response("{}", { status }));
      const error = await caught(
        new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
      );
      expect(error.kind).toBe(kind);
      expect(error.transient).toBe(false);
    }
  });

  it("5xx — временный сбой", async () => {
    const { impl } = fakeFetch(async () => new Response("oops", { status: 502 }));
    const error = await caught(
      new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
    );
    expect(error.kind).toBe("HTTP");
    expect(error.transient).toBe(true);
  });

  it("таймаут прерывает запрос", async () => {
    const { impl } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const client = new FootballDataClient({ token: TOKEN, fetchImpl: impl, timeoutMs: 20 });
    const error = await caught(client.getJson("/x"));
    expect(error.kind).toBe("TIMEOUT");
    expect(error.transient).toBe(true);
  });

  it("сетевая ошибка", async () => {
    const { impl } = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const error = await caught(
      new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
    );
    expect(error.kind).toBe("NETWORK");
  });

  it("не-JSON ответ", async () => {
    const { impl } = fakeFetch(async () => new Response("<html>", { status: 200 }));
    const error = await caught(
      new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
    );
    expect(error.kind).toBe("INVALID_RESPONSE");
  });

  it("токен не попадает в сообщения об ошибках", async () => {
    for (const status of [401, 403, 429, 500]) {
      const { impl } = fakeFetch(async () => new Response("{}", { status }));
      const error = await caught(
        new FootballDataClient({ token: TOKEN, fetchImpl: impl }).getJson("/x"),
      );
      expect(error.message).not.toContain(TOKEN);
    }
  });

  it("принимает только относительный путь", async () => {
    const { impl } = fakeFetch(async () => new Response("{}", { status: 200 }));
    const client = new FootballDataClient({ token: TOKEN, fetchImpl: impl });
    let thrown = false;
    try {
      await client.getJson("//evil.example/x");
    } catch {
      thrown = true;
    }
    expect(thrown).toBe(true);
  });
});
