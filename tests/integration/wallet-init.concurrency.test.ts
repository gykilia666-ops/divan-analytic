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

/** Выбор псевдонима от имени пользователя так же, как это делает PostgREST: роль + JWT-claims. */
async function chooseAs(userId: string, name: string): Promise<{ ok: boolean; code?: string }> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const res = await client.query("select public.set_pseudonym($1) as r", [name]);
    await client.query("commit");
    return res.rows[0].r as { ok: boolean; code?: string };
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

const suffix = () => randomUUID().slice(0, 8);

describe("set_pseudonym: создание профиля и кошелька, конкурентность (ADR-075)", () => {
  it("вход без выбора псевдонима ничего не создает: ни профиля, ни кошелька, ни журнала", async () => {
    const userId = await createAuthUser("idle");
    const counts = await pool.query(
      `select (select count(*) from public.profiles where id = $1)::int as p,
              (select count(*) from public.wallets where user_id = $1)::int as w,
              (select count(*) from public.wallet_entries where user_id = $1)::int as e`,
      [userId],
    );
    expect(counts.rows[0]).toEqual({ p: 0, w: 0, e: 0 });
  });

  it("20 параллельных вызовов с одним именем дают ровно одно начисление", async () => {
    const userId = await createAuthUser("racer");
    const name = `racer-${suffix()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => chooseAs(userId, name)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(await ledgerState(userId)).toEqual({
      entryCount: 1,
      ledgerSum: 10_000,
      balance: 10_000,
    });
  });

  it("параллельные вызовы с разными именами: принято одно, остальные — ALREADY_SET", async () => {
    const userId = await createAuthUser("indecisive");
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => chooseAs(userId, `variant-${i}-${suffix()}`)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.code === "ALREADY_SET")).toHaveLength(9);
    expect(await ledgerState(userId)).toEqual({
      entryCount: 1,
      ledgerSum: 10_000,
      balance: 10_000,
    });
  });

  it("повторные последовательные вызовы не начисляют снова", async () => {
    const userId = await createAuthUser("sequential");
    const name = `seq-${suffix()}`;
    for (let i = 0; i < 3; i++) expect((await chooseAs(userId, name)).ok).toBe(true);
    expect(await ledgerState(userId)).toEqual({
      entryCount: 1,
      ledgerSum: 10_000,
      balance: 10_000,
    });
  });

  it("один и тот же псевдоним у двух пользователей: второй получает NAME_TAKEN и ничего не создает", async () => {
    const name = `dup-${suffix()}`;
    const first = await createAuthUser("first");
    const second = await createAuthUser("second");
    expect((await chooseAs(first, name)).ok).toBe(true);
    const lost = await chooseAs(second, name.toUpperCase());
    expect(lost).toMatchObject({ ok: false, code: "NAME_TAKEN" });

    const rows = await pool.query(
      "select (select count(*) from public.profiles where id = $1)::int as p, (select count(*) from public.wallets where user_id = $1)::int as w",
      [second],
    );
    expect(rows.rows[0]).toEqual({ p: 0, w: 0 });
  });

  it("одновременный выбор одного имени разными пользователями: имя достается одному", async () => {
    const name = `race-${suffix()}`;
    const ids = await Promise.all(
      Array.from({ length: 8 }, (_, i) => createAuthUser(`rival-${i}`)),
    );
    const results = await Promise.all(ids.map((id) => chooseAs(id, name)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.code === "NAME_TAKEN")).toHaveLength(7);
    const profiles = await pool.query(
      "select count(*)::int as n from public.profiles where id = any($1::uuid[])",
      [ids],
    );
    expect(profiles.rows[0].n).toBe(1);
  });

  it("параллельный выбор у разных пользователей не влияет друг на друга", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createAuthUser(`user-${i}`)),
    );
    const results = await Promise.all(ids.map((id, i) => chooseAs(id, `many-${i}-${suffix()}`)));

    expect(results.every((r) => r.ok)).toBe(true);
    for (const id of ids) {
      expect(await ledgerState(id)).toEqual({ entryCount: 1, ledgerSum: 10_000, balance: 10_000 });
    }
  });
});
