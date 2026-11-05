import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * HTTP-слой маршрутов (docs/testing-strategy.md, п. 2). Бизнес-логика проверена в БД (pgTAP); здесь —
 * обертка: Origin, вход, роль, разбор тела, перевод кодов БД в статусы, отсутствие кеша у приватных ответов.
 * Сессия, Supabase и задание подменены; ни один отказ не должен доходить до бизнес-RPC.
 */

const ORIGIN = "https://app.test";
const env = {
  APP_DATA_MODE: "connected" as "connected" | "demo",
  SPORTS_PROVIDER: "fixtures",
  APP_ORIGIN: ORIGIN,
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SERVICE_ROLE_KEY: "sk",
  CRON_SECRET: "x".repeat(40),
};

const rpc = vi.fn();
const signOut = vi.fn();
const getCurrentUser = vi.fn();
const getCurrentProfile = vi.fn();
const executeSyncJob = vi.fn();
const adminDeleteUser = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getEnv: () => env,
  getPublicConfig: () => ({ dataMode: env.APP_DATA_MODE }),
}));
vi.mock("@/server/auth/session", () => ({
  getCurrentUser: () => getCurrentUser(),
  getCurrentProfile: () => getCurrentProfile(),
}));
vi.mock("@/server/db/supabase-server", () => ({
  createClient: async () => ({ rpc, auth: { signOut } }),
}));
vi.mock("@/server/db/supabase-admin", () => ({
  createAdminClient: () => ({ auth: { admin: { deleteUser: adminDeleteUser } } }),
}));
vi.mock("@/server/jobs/execute", () => ({
  executeSyncJob: (...a: unknown[]) => executeSyncJob(...a),
}));
vi.mock("@/server/observability/log", () => ({ logEvent: () => {} }));

const { POST: betsPost } = await import("@/app/api/v1/bets/route");
const { POST: pseudonymPost } = await import("@/app/api/v1/me/pseudonym/route");
const { DELETE: accountDelete } = await import("@/app/api/v1/me/account/route");
const { POST: adminSyncPost } = await import("@/app/api/admin/sync/route");
const { POST: conflictsPost } = await import("@/app/api/admin/conflicts/route");
const { GET: adminJobsGet } = await import("@/app/api/admin/jobs/route");
const { GET: meGet } = await import("@/app/api/v1/me/route");
const { GET: myBetsGet } = await import("@/app/api/v1/me/bets/route");
const { GET: myStatsGet } = await import("@/app/api/v1/me/stats/route");

type Handler = (req: NextRequest) => Promise<Response>;

const USER = { id: "11111111-1111-4111-8111-111111111111" };
const MATCH = "22222222-2222-4222-8222-222222222222";

/** Изменяющие маршруты: метод, путь, обработчик, корректное тело, бизнес-RPC и нужна ли роль. */
const MUTATING: [string, string, Handler, unknown, string, boolean][] = [
  [
    "POST",
    "/api/v1/bets",
    betsPost,
    {
      marketId: "33333333-3333-4333-8333-333333333333",
      outcome: "HOME",
      stake: 100,
      quoteVersion: 1,
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    },
    "place_bet",
    false,
  ],
  [
    "POST",
    "/api/v1/me/pseudonym",
    pseudonymPost,
    { name: "Тихий Форвард" },
    "set_pseudonym",
    false,
  ],
  [
    "DELETE",
    "/api/v1/me/account",
    accountDelete,
    { confirm: "Тихий Форвард" },
    "delete_my_account",
    false,
  ],
  ["POST", "/api/admin/sync", adminSyncPost, {}, "admin_request_sync", true],
  [
    "POST",
    "/api/admin/conflicts",
    conflictsPost,
    { matchId: MATCH, note: "сверено с протоколом" },
    "admin_resolve_conflict",
    true,
  ],
];

function request(
  method: string,
  path: string,
  { origin = ORIGIN, body, raw }: { origin?: string | null; body?: unknown; raw?: string } = {},
): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  const hasBody = method !== "GET";
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers,
    body: hasBody ? (raw ?? JSON.stringify(body ?? {})) : undefined,
  });
}

function businessCalls(name: string): number {
  return rpc.mock.calls.filter((c) => c[0] === name).length;
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

beforeEach(() => {
  env.APP_DATA_MODE = "connected";
  rpc.mockReset();
  signOut.mockReset();
  getCurrentUser.mockReset().mockResolvedValue(USER);
  getCurrentProfile
    .mockReset()
    .mockResolvedValue({ id: USER.id, displayName: "Тихий Форвард", avatarUrl: null });
  executeSyncJob.mockReset().mockResolvedValue({ status: "OK", errors: [] });
  adminDeleteUser.mockReset().mockResolvedValue({ error: null });
  // По умолчанию: пользователь — администратор, бизнес-RPC отвечают успехом.
  rpc.mockImplementation(async (name: string) => {
    if (name === "is_admin") return { data: true, error: null };
    if (name === "admin_request_sync") return { data: { ok: true }, error: null };
    if (name === "delete_my_account")
      return { data: { ok: true, alreadyDeleted: false }, error: null };
    return { data: null, error: null };
  });
});

describe.each(MUTATING)("%s %s", (method, path, handler, body, businessRpc, adminOnly) => {
  it("без заголовка Origin — 403, без обращения к бизнес-функции", async () => {
    const res = await handler(request(method, path, { origin: null, body }));
    expect(res.status).toBe(403);
    expect(businessCalls(businessRpc)).toBe(0);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("чужой Origin — 403", async () => {
    const res = await handler(request(method, path, { origin: "https://evil.example", body }));
    expect(res.status).toBe(403);
    expect(businessCalls(businessRpc)).toBe(0);
  });

  it("Origin с другим портом или схемой — 403", async () => {
    const res = await handler(request(method, path, { origin: "http://app.test", body }));
    expect(res.status).toBe(403);
    expect(businessCalls(businessRpc)).toBe(0);
  });

  it("без входа — 401", async () => {
    getCurrentUser.mockResolvedValue(null);
    getCurrentProfile.mockResolvedValue(null);
    const res = await handler(request(method, path, { body }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHENTICATED");
    expect(businessCalls(businessRpc)).toBe(0);
  });

  it("в demo-режиме недоступен (404/503)", async () => {
    env.APP_DATA_MODE = "demo";
    const res = await handler(request(method, path, { body }));
    expect([404, 503]).toContain(res.status);
    expect(rpc).not.toHaveBeenCalled();
  });

  if (adminOnly) {
    it("обычный пользователь — 403 FORBIDDEN", async () => {
      rpc.mockImplementation(async (name: string) =>
        name === "is_admin" ? { data: false, error: null } : { data: null, error: null },
      );
      const res = await handler(request(method, path, { body }));
      expect(res.status).toBe(403);
      expect(businessCalls(businessRpc)).toBe(0);
      expect(executeSyncJob).not.toHaveBeenCalled();
    });
  }

  if (path !== "/api/admin/sync") {
    it("некорректный JSON — 400 VALIDATION_ERROR", async () => {
      const res = await handler(request(method, path, { raw: "{not json" }));
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe("VALIDATION_ERROR");
      expect(businessCalls(businessRpc)).toBe(0);
    });

    it("слишком большое тело — 400", async () => {
      const res = await handler(
        request(method, path, { raw: JSON.stringify({ pad: "x".repeat(5000) }) }),
      );
      expect(res.status).toBe(400);
      expect(businessCalls(businessRpc)).toBe(0);
    });
  }
});

describe("перевод ответов БД в HTTP", () => {
  const bet = MUTATING[0]![3];

  it.each([
    ["INSUFFICIENT_BALANCE", 422],
    ["QUOTE_CHANGED", 409],
    ["MARKET_CLOSED", 409],
    ["RATE_LIMITED", 429],
    ["PSEUDONYM_REQUIRED", 403],
  ])("place_bet %s → %i", async (code, status) => {
    rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    const res = await betsPost(request("POST", "/api/v1/bets", { body: bet }));
    expect(res.status).toBe(status);
    expect(await errorCode(res)).toBe(code);
  });

  it("сбой БД при приеме — 503 без подробностей", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret internals" } });
    const res = await betsPost(request("POST", "/api/v1/bets", { body: bet }));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret internals");
  });

  it("лишние поля в прогнозе (например, коэффициент) — 400", async () => {
    const res = await betsPost(
      request("POST", "/api/v1/bets", { body: { ...(bet as object), oddsMilli: 12000 } }),
    );
    expect(res.status).toBe(400);
    expect(businessCalls("place_bet")).toBe(0);
  });

  it("занятый псевдоним — 409 NAME_TAKEN", async () => {
    rpc.mockResolvedValue({ data: { ok: false, code: "NAME_TAKEN" }, error: null });
    const res = await pseudonymPost(
      request("POST", "/api/v1/me/pseudonym", { body: { name: "Тихий Форвард" } }),
    );
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("NAME_TAKEN");
  });

  it("недопустимый псевдоним отклоняется до БД — 422", async () => {
    const res = await pseudonymPost(
      request("POST", "/api/v1/me/pseudonym", { body: { name: "<b>" } }),
    );
    expect(res.status).toBe(422);
    expect(businessCalls("set_pseudonym")).toBe(0);
  });

  it("удаление аккаунта: неверное подтверждение — 400, ничего не удаляется", async () => {
    const res = await accountDelete(
      request("DELETE", "/api/v1/me/account", { body: { confirm: "кто-то другой" } }),
    );
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("CONFIRMATION_MISMATCH");
    expect(businessCalls("delete_my_account")).toBe(0);
    expect(adminDeleteUser).not.toHaveBeenCalled();
  });

  it("удаление аккаунта: успех — мягкое удаление в Auth и выход", async () => {
    const res = await accountDelete(
      request("DELETE", "/api/v1/me/account", { body: { confirm: "Тихий Форвард" } }),
    );
    expect(res.status).toBe(200);
    expect(adminDeleteUser).toHaveBeenCalledWith(USER.id, true);
    expect(signOut).toHaveBeenCalled();
  });

  it("ручной запуск чаще лимита — 429, задание не запускается", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "is_admin"
        ? { data: true, error: null }
        : { data: { ok: false, code: "RATE_LIMITED" }, error: null },
    );
    const res = await adminSyncPost(request("POST", "/api/admin/sync", { body: {} }));
    expect(res.status).toBe(429);
    expect(executeSyncJob).not.toHaveBeenCalled();
  });

  it("ручной запуск администратором — 200 и одно задание", async () => {
    const res = await adminSyncPost(request("POST", "/api/admin/sync", { body: {} }));
    expect(res.status).toBe(200);
    expect(executeSyncJob).toHaveBeenCalledTimes(1);
  });
});

describe("приватные чтения", () => {
  it.each([
    ["GET /api/v1/me", () => meGet()],
    ["GET /api/v1/me/stats", () => myStatsGet()],
    ["GET /api/v1/me/bets", () => myBetsGet(request("GET", "/api/v1/me/bets"))],
    ["GET /api/admin/jobs", () => adminJobsGet()],
  ] as const)("%s без входа — 401 и no-store", async (_name, call) => {
    getCurrentUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("GET /api/admin/jobs обычному пользователю — 403", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await adminJobsGet();
    expect(res.status).toBe(403);
  });
});
