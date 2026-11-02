import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Конкурентная инициализация кошелька (CLAUDE.md §6.3, §18.2).
 * Требует запущенный локальный Supabase: `npm run db:start` (миграции применяются автоматически).
 * Пароль ниже — стандартное значение локального Supabase CLI, не секрет.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const pool = new Pool({ connectionString: DATABASE_URL, max: 25 });

afterAll(async () => {
  await pool.end();
});

async function createAuthUser(name: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
    [id, `${id}@test.local`, JSON.stringify({ user_name: name })],
  );
  return id;
}

/** Вызов RPC от имени пользователя так же, как это делает PostgREST: роль + JWT-claims. */
async function initAs(userId: string): Promise<{ balance: number; credited: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const res = await client.query(
      "select wallet_balance, credited from public.ensure_user_initialized()",
    );
    await client.query("commit");
    const row = res.rows[0] as { wallet_balance: string; credited: boolean };
    return { balance: Number(row.wallet_balance), credited: row.credited };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function ledgerState(userId: string) {
  const entries = await pool.query(
    "select count(*)::int as n, coalesce(sum(amount), 0)::bigint as total from public.wallet_entries where user_id = $1",
    [userId],
  );
  const wallet = await pool.query("select balance from public.wallets where user_id = $1", [
    userId,
  ]);
  return {
    entryCount: entries.rows[0].n as number,
    ledgerSum: Number(entries.rows[0].total),
    balance: Number(wallet.rows[0].balance),
  };
}

describe("ensure_user_initialized: конкурентность", () => {
  it("20 параллельных вызовов одного пользователя дают ровно одно начисление", async () => {
    const userId = await createAuthUser("racer");
    const results = await Promise.all(Array.from({ length: 20 }, () => initAs(userId)));

    expect(results.filter((r) => r.credited)).toHaveLength(1);
    expect(results.every((r) => r.balance === 10_000)).toBe(true);

    const state = await ledgerState(userId);
    expect(state).toEqual({ entryCount: 1, ledgerSum: 10_000, balance: 10_000 });
  });

  it("повторные последовательные вызовы не начисляют снова", async () => {
    const userId = await createAuthUser("sequential");
    const first = await initAs(userId);
    const second = await initAs(userId);
    const third = await initAs(userId);

    expect(first.credited).toBe(true);
    expect(second.credited).toBe(false);
    expect(third.credited).toBe(false);
    expect(await ledgerState(userId)).toEqual({
      entryCount: 1,
      ledgerSum: 10_000,
      balance: 10_000,
    });
  });

  it("параллельная инициализация разных пользователей не влияет друг на друга", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createAuthUser(`user-${i}`)),
    );
    const results = await Promise.all(ids.map((id) => initAs(id)));

    expect(results.every((r) => r.credited && r.balance === 10_000)).toBe(true);
    for (const id of ids) {
      expect(await ledgerState(id)).toEqual({ entryCount: 1, ledgerSum: 10_000, balance: 10_000 });
    }
  });
});
