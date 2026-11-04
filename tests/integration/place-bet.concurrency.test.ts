import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Конкурентный прием прогнозов (CLAUDE.md §18.2). Требует локальный Supabase (`npm run db:start`).
 * Прогнозы и журнал неизменяемы, поэтому данные теста остаются в локальной БД под своим
 * поставщиком (it-bet-*); `npm run db:reset` их убирает. Пароль — стандартный локальный, не секрет.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const pool = new Pool({ connectionString: DATABASE_URL, max: 30 });

type BetResult = {
  ok: boolean;
  code?: string;
  replay?: boolean;
  balance?: number;
  bet?: { id: string; potentialPayout: number };
};

const provider = `it-bet-${randomUUID()}`;
let competitionId = "";
let homeId = "";
let awayId = "";

async function createMarket(): Promise<string> {
  const match = await pool.query(
    `insert into public.matches (provider, provider_id, competition_id, home_team_id, away_team_id,
       kickoff_at, status, last_seen_at)
     values ($1, $2, $3, $4, $5, now() + interval '2 days', 'SCHEDULED', now()) returning id`,
    [provider, randomUUID(), competitionId, homeId, awayId],
  );
  const market = await pool.query(
    `insert into public.markets (match_id, type, status, quote_version, model_version,
       home_odds_milli, draw_odds_milli, away_odds_milli)
     values ($1, 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000) returning id`,
    [match.rows[0].id],
  );
  return market.rows[0].id as string;
}

async function createUser(balance = 10_000): Promise<string> {
  const id = randomUUID();
  await pool.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
    [id, `${id}@test.local`, JSON.stringify({ user_name: "bettor" })],
  );
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
    await client.query("select public.ensure_user_initialized()");
    await client.query("commit");

    if (balance !== 10_000) {
      await client.query("begin");
      await client.query(
        `insert into public.wallet_entries (user_id, kind, amount, operation_key)
         values ($1, 'ADMIN_ADJUSTMENT', $2, $3)`,
        [id, balance - 10_000, `test-adjust:${id}`],
      );
      await client.query("update public.wallets set balance = $2 where user_id = $1", [
        id,
        balance,
      ]);
      await client.query("commit");
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return id;
}

async function placeBet(
  userId: string,
  marketId: string,
  stake: number,
  key: string,
  outcome = "HOME",
): Promise<BetResult> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    const res = await client.query("select public.place_bet($1, $2, $3, 1, $4) as r", [
      marketId,
      outcome,
      stake,
      key,
    ]);
    await client.query("commit");
    return res.rows[0].r as BetResult;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function walletState(userId: string) {
  const res = await pool.query(
    `select w.balance::bigint as balance,
       (select coalesce(sum(e.amount), 0)::bigint from public.wallet_entries e where e.user_id = w.user_id) as ledger,
       (select count(*)::int from public.bets b where b.user_id = w.user_id) as bets,
       (select count(*)::int from public.wallet_entries e where e.user_id = w.user_id and e.kind = 'STAKE_DEBIT') as debits
     from public.wallets w where w.user_id = $1`,
    [userId],
  );
  const row = res.rows[0];
  return {
    balance: Number(row.balance),
    ledger: Number(row.ledger),
    bets: row.bets as number,
    debits: row.debits as number,
  };
}

beforeAll(async () => {
  const comp = await pool.query(
    `insert into public.competitions (provider, provider_id, code, name, enabled)
     values ($1, 'c', 'IT', 'Integration', true) returning id`,
    [provider],
  );
  competitionId = comp.rows[0].id;
  const teams = await pool.query(
    `insert into public.teams (provider, provider_id, name) values ($1, 'h', 'Home'), ($1, 'a', 'Away')
     returning id`,
    [provider],
  );
  homeId = teams.rows[0].id;
  awayId = teams.rows[1].id;
});

afterAll(async () => {
  await pool.end();
});

describe("place_bet: конкурентность", () => {
  it("баланс 1000, 20 параллельных прогнозов по 150 на разные рынки: ровно 6 приняты, баланс ≥ 0", async () => {
    const user = await createUser(1000);
    const markets = await Promise.all(Array.from({ length: 20 }, () => createMarket()));
    const results = await Promise.all(markets.map((m) => placeBet(user, m, 150, randomUUID())));

    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(6);
    for (const r of results.filter((x) => !x.ok)) {
      expect(["INSUFFICIENT_BALANCE", "RATE_LIMITED"]).toContain(r.code);
    }
    const state = await walletState(user);
    expect(state.balance).toBe(100);
    expect(state.balance).toBe(state.ledger);
    expect([state.bets, state.debits]).toEqual([6, 6]);
  });

  it("один ключ, два одинаковых параллельных запроса: один прогноз, одно списание, одинаковый ответ", async () => {
    const user = await createUser();
    const market = await createMarket();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      placeBet(user, market, 100, key),
      placeBet(user, market, 100, key),
    ]);

    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(a.bet?.id).toBe(b.bet?.id);
    expect([a.replay, b.replay].sort()).toEqual([false, true]);
    const state = await walletState(user);
    expect([state.bets, state.debits, state.balance]).toEqual([1, 1, 9900]);
    expect(state.balance).toBe(state.ledger);
  });

  it("один ключ, разное содержимое параллельно: одна операция, второй — конфликт", async () => {
    const user = await createUser();
    const market = await createMarket();
    const key = randomUUID();
    const results = await Promise.all([
      placeBet(user, market, 100, key),
      placeBet(user, market, 200, key),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.code === "IDEMPOTENCY_CONFLICT")).toHaveLength(1);
    const state = await walletState(user);
    expect([state.bets, state.debits]).toEqual([1, 1]);
    expect(state.balance).toBe(state.ledger);
  });

  it("10 параллельных прогнозов на один рынок с разными ключами: принят один", async () => {
    const user = await createUser();
    const market = await createMarket();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        placeBet(user, market, 100, randomUUID(), ["HOME", "DRAW", "AWAY"][i % 3]),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.code === "ALREADY_PLACED")).toHaveLength(9);
    const state = await walletState(user);
    expect([state.bets, state.debits, state.balance]).toEqual([1, 1, 9900]);
  });

  it("повтор после неопределенного сетевого ответа безопасен", async () => {
    const user = await createUser();
    const market = await createMarket();
    const key = randomUUID();
    const first = await placeBet(user, market, 300, key); // ответ «потерялся»
    const retry = await placeBet(user, market, 300, key);
    expect(retry).toMatchObject({ ok: true, replay: true });
    expect(retry.bet?.id).toBe(first.bet?.id);
    const state = await walletState(user);
    expect([state.bets, state.debits, state.balance]).toEqual([1, 1, 9700]);
  });
});
