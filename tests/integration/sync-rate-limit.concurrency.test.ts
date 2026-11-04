import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Общий лимитер запросов к поставщику (CLAUDE.md §10.5): cron и ручной запуск делят бюджет.
 * Требует локальный Supabase (`npm run db:start`). Пароль — стандартный локальный, не секрет.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new Pool({ connectionString: DATABASE_URL, max: 25 });

afterAll(async () => {
  await pool.end();
});

async function acquire(provider: string, limit: number): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const res = await client.query("select allowed from public.provider_try_acquire($1, $2)", [
      provider,
      limit,
    ]);
    await client.query("commit");
    return (res.rows[0] as { allowed: boolean }).allowed;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

describe("provider_try_acquire: конкурентность", () => {
  it("20 параллельных запросов при лимите 8 — ровно 8 разрешений", async () => {
    const provider = `it-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => acquire(provider, 8)));
    expect(results.filter(Boolean)).toHaveLength(8);

    const row = await pool.query(
      "select request_count from public.provider_rate_limits where provider = $1",
      [provider],
    );
    expect(row.rows[0].request_count).toBe(8);
    await pool.query("delete from public.provider_rate_limits where provider = $1", [provider]);
  });

  it("параллельный импорт одного и того же матча не создает дубликатов", async () => {
    const provider = `it-${randomUUID()}`;
    const payload = {
      competitions: [{ provider_id: "c1", code: "TST", name: "Test League" }],
      teams: [
        { provider_id: "t1", name: "Home", short_name: null },
        { provider_id: "t2", name: "Away", short_name: null },
      ],
      matches: [
        {
          provider_id: "m1",
          competition_provider_id: "c1",
          home_provider_id: "t1",
          away_provider_id: "t2",
          kickoff_at: "2026-11-10T15:00:00Z",
          status: "SCHEDULED",
          home_score: null,
          away_score: null,
          result_kind: "NONE",
          provider_updated_at: "2026-11-04T00:00:00Z",
        },
      ],
    };

    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query("set role service_role");
        await client.query("select public.sync_upsert_matches($1, $2::jsonb)", [
          provider,
          JSON.stringify(payload),
        ]);
      } finally {
        await client.query("reset role").catch(() => undefined);
        client.release();
      }
    };
    await Promise.all(Array.from({ length: 10 }, run));

    const count = await pool.query(
      "select count(*)::int as n from public.matches where provider = $1",
      [provider],
    );
    expect(count.rows[0].n).toBe(1);

    // Тестовые строки не должны влиять на другие тесты в той же локальной БД.
    await pool.query("delete from public.matches where provider = $1", [provider]);
    await pool.query("delete from public.teams where provider = $1", [provider]);
    await pool.query("delete from public.competitions where provider = $1", [provider]);
  });
});
