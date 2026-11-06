import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Конкурентный расчет и fencing (docs/requirements.md §10.4, §18.2). Требует локальный Supabase.
 * Данные остаются в локальной БД под поставщиком it-settle-* (журнал неизменяем); db:reset их убирает.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new Pool({ connectionString: DATABASE_URL, max: 30 });
const provider = `it-settle-${randomUUID()}`;
const job = `it-job-${randomUUID()}`;
let competitionId = "";
let homeId = "";
let awayId = "";

async function asUser<T>(userId: string, sql: string, params: unknown[]): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const res = await client.query(sql, params);
    await client.query("commit");
    return res.rows[0] as T;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createUser(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
    [id, `${id}@test.local`, JSON.stringify({ user_name: "settler" })],
  );
  // Профиль, кошелек и стартовый кредит создает выбор псевдонима (ADR-075); без него прогнозы закрыты (ADR-074).
  await asUser(id, "select public.set_pseudonym($1)", [
    `st-${id.replaceAll("-", "").slice(0, 12)}`,
  ]);
  return id;
}

/** Рынок с прогнозом пользователя, затем матч завершен 2:0 и итог подтвержден. */
async function marketWithBet(userId: string, outcome: string, stake: number) {
  const match = await pool.query(
    `insert into public.matches (provider, provider_id, competition_id, home_team_id, away_team_id,
       kickoff_at, status, last_seen_at)
     values ($1, $2, $3, $4, $5, now() + interval '1 day', 'SCHEDULED', now()) returning id`,
    [provider, randomUUID(), competitionId, homeId, awayId],
  );
  const matchId = match.rows[0].id as string;
  const market = await pool.query(
    `insert into public.markets (match_id, type, status, quote_version, model_version,
       home_odds_milli, draw_odds_milli, away_odds_milli)
     values ($1, 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2500, 3000, 4000) returning id`,
    [matchId],
  );
  const marketId = market.rows[0].id as string;
  const placed = await asUser<{ r: { ok: boolean } }>(
    userId,
    "select public.place_bet($1, $2, $3, 1, $4) as r",
    [marketId, outcome, stake, randomUUID()],
  );
  expect(placed.r.ok).toBe(true);

  await pool.query(
    `update public.matches set kickoff_at = now() - interval '2 hours', status = 'FINISHED',
       regulation_home_score = 2, regulation_away_score = 0, result_kind = 'REGULAR',
       result_fingerprint = 'FINISHED:2:0', result_first_seen_at = now() - interval '20 minutes',
       result_confirmed_at = now()
     where id = $1`,
    [matchId],
  );
  await pool.query("update public.markets set status = 'CLOSED' where id = $1", [marketId]);
  return { matchId, marketId };
}

async function settle(owner: string, generation: number) {
  const res = await pool.query("select public.settle_ready_markets($1, $2, $3, 500) as r", [
    job,
    owner,
    generation,
  ]);
  return res.rows[0].r as { resolved: number; failed: number };
}

async function wallet(userId: string) {
  const res = await pool.query(
    `select w.balance::bigint as balance,
       (select sum(amount)::bigint from public.wallet_entries e where e.user_id = w.user_id) as ledger,
       (select count(*)::int from public.wallet_entries e where e.user_id = w.user_id and e.kind = 'WIN_CREDIT') as wins
     from public.wallets w where w.user_id = $1`,
    [userId],
  );
  return {
    balance: Number(res.rows[0].balance),
    ledger: Number(res.rows[0].ledger),
    wins: res.rows[0].wins as number,
  };
}

beforeAll(async () => {
  competitionId = (
    await pool.query(
      `insert into public.competitions (provider, provider_id, code, name, enabled)
       values ($1, 'c', 'IT', 'Integration', true) returning id`,
      [provider],
    )
  ).rows[0].id;
  const teams = await pool.query(
    `insert into public.teams (provider, provider_id, name) values ($1, 'h', 'Home'), ($1, 'a', 'Away') returning id`,
    [provider],
  );
  homeId = teams.rows[0].id;
  awayId = teams.rows[1].id;
});

afterAll(async () => {
  await pool.end();
});

describe("расчет: конкурентность и fencing", () => {
  it("10 параллельных расчетов: один переход, одно начисление, журнал = баланс", async () => {
    const user = await createUser();
    const { marketId } = await marketWithBet(user, "HOME", 200);
    const owner = randomUUID();
    const gen = Number(
      (await pool.query("select public.job_acquire_lease($1, $2, 60) as g", [job, owner])).rows[0]
        .g,
    );

    const results = await Promise.all(Array.from({ length: 10 }, () => settle(owner, gen)));
    expect(results.every((r) => r.failed === 0)).toBe(true);

    const bet = await pool.query(
      "select status, actual_payout from public.bets where market_id = $1",
      [marketId],
    );
    expect(bet.rows[0]).toEqual({ status: "WON", actual_payout: "500" });
    const w = await wallet(user);
    expect([w.balance, w.wins]).toEqual([10_300, 1]);
    expect(w.balance).toBe(w.ledger);
    await pool.query("select public.job_release_lease($1, $2, $3)", [job, owner, gen]);
  });

  it("устаревший исполнитель не пишет после потери аренды", async () => {
    const user = await createUser();
    const { marketId } = await marketWithBet(user, "AWAY", 100);
    const oldOwner = randomUUID();
    const oldGen = Number(
      (await pool.query("select public.job_acquire_lease($1, $2, 60) as g", [job, oldOwner]))
        .rows[0].g,
    );
    // Аренда старого исполнителя истекла, задание перехватил новый.
    await pool.query(
      "update public.job_leases set lease_until = now() - interval '1 second' where job_name = $1",
      [job],
    );
    const newOwner = randomUUID();
    const newGen = Number(
      (await pool.query("select public.job_acquire_lease($1, $2, 60) as g", [job, newOwner]))
        .rows[0].g,
    );
    expect(newGen).toBe(oldGen + 1);

    await expect(settle(oldOwner, oldGen)).rejects.toThrow(/LEASE_LOST/);
    const pending = await pool.query("select status from public.bets where market_id = $1", [
      marketId,
    ]);
    expect(pending.rows[0].status).toBe("PENDING");

    // Новый владелец рассчитывает; повторный запуск — без изменений.
    await settle(newOwner, newGen);
    await settle(newOwner, newGen);
    const bet = await pool.query(
      "select status, actual_payout from public.bets where market_id = $1",
      [marketId],
    );
    expect(bet.rows[0]).toEqual({ status: "LOST", actual_payout: "0" });
    const w = await wallet(user);
    expect([w.balance, w.ledger]).toEqual([9_900, 9_900]);
    await pool.query("select public.job_release_lease($1, $2, $3)", [job, newOwner, newGen]);
  });
});
