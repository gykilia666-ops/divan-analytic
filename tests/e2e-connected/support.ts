import { createHmac, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { LEGAL_VERSION } from "../../src/lib/legal-version";
import { connectedEnv, E2E_ORIGIN } from "./env";

/**
 * Помощники e2e connected. Вход через GitHub не автоматизируется (внешняя система), а вход по почте выключен
 * так же, как в production (config.toml: [auth.email] enable_signup = false). Поэтому пользователь создается
 * admin API локального Supabase, а токен доступа подписывается локальным JWT-секретом стенда (стандартный, не
 * секрет; облако здесь недоступно — см. env.ts). Сессию в cookie записывает тот же @supabase/ssr, что и в
 * приложении; согласия — как в /auth/callback. Данные — под поставщиком fixtures.
 */
const env = connectedEnv();
export const pool = new pg.Pool({ connectionString: env.dbUrl, max: 4 });

export interface TestUser {
  id: string;
  email: string;
}

export async function createUser(): Promise<TestUser> {
  const admin = createClient(env.apiUrl, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `e2e-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { user_name: `e2e_${randomUUID().slice(0, 8)}` },
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message ?? "no user"}`);
  return { id: data.user.id, email };
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Токен доступа пользователя на 1 час (HS256, секрет локального стенда). */
function accessToken(user: TestUser): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      role: "authenticated",
      aud: "authenticated",
      iss: `${env.apiUrl}/auth/v1`,
      iat: now,
      exp: now + 3600,
      aal: "aal1",
      amr: [{ method: "password", timestamp: now }],
      is_anonymous: false,
    }),
  );
  const signature = createHmac("sha256", env.jwtSecret).update(`${header}.${payload}`).digest();
  return `${header}.${payload}.${b64url(signature)}`;
}

/** Входит пользователем: cookie сессии в контекст браузера + согласия, как после /auth/callback. */
export async function loginAs(context: BrowserContext, user: TestUser): Promise<void> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(env.apiUrl, env.anonKey, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.setSession({
    access_token: accessToken(user),
    refresh_token: `e2e-${randomUUID()}`,
  });
  if (error) throw new Error(`setSession: ${error.message}`);
  const consent = await supabase.rpc("record_consents", { p_version: LEGAL_VERSION });
  if (consent.error) throw new Error(`record_consents: ${consent.error.message}`);
  await context.addCookies(
    [...jar].map(([name, value]) => ({ name, value, url: E2E_ORIGIN, sameSite: "Lax" as const })),
  );
}

/** Уникальный псевдоним по правилам (буквы, цифры, пробел; 3–24 символа). */
export function pseudonym(): string {
  return `Игрок ${randomUUID().replace(/\D/g, "").slice(0, 8)}`;
}

/** Открытый рынок 2.00 / 3.00 / 4.00 на матч через 2 дня у поставщика fixtures. */
export async function createOpenMarket(): Promise<{ matchId: string; marketId: string }> {
  const comp = await pool.query(
    `insert into public.competitions (provider, provider_id, code, name, enabled)
     values ('fixtures', 'e2e', 'E2E', 'Лига e2e', true)
     on conflict (provider, provider_id) do update set enabled = true returning id`,
  );
  const teams = await pool.query(
    `insert into public.teams (provider, provider_id, name) values
       ('fixtures', 'e2e-home', 'Хозяева e2e'), ('fixtures', 'e2e-away', 'Гости e2e')
     on conflict (provider, provider_id) do update set name = excluded.name returning id`,
  );
  const match = await pool.query(
    `insert into public.matches (provider, provider_id, competition_id, home_team_id, away_team_id,
       kickoff_at, status, last_seen_at)
     values ('fixtures', $1, $2, $3, $4, now() + interval '2 days', 'SCHEDULED', now()) returning id`,
    [`e2e-${randomUUID()}`, comp.rows[0].id, teams.rows[0].id, teams.rows[1].id],
  );
  const market = await pool.query(
    `insert into public.markets (match_id, type, status, quote_version, model_version,
       home_odds_milli, draw_odds_milli, away_odds_milli)
     values ($1, 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 2000, 3000, 4000) returning id`,
    [match.rows[0].id],
  );
  return { matchId: match.rows[0].id as string, marketId: market.rows[0].id as string };
}

/** Итог основного времени подтвержден, рынок закрыт и рассчитан — как это сделал бы конвейер. */
export async function finishAndSettle(matchId: string, home: number, away: number): Promise<void> {
  await pool.query(
    `update public.matches set kickoff_at = now() - interval '3 hours', status = 'FINISHED',
       result_kind = 'REGULAR', regulation_home_score = $2, regulation_away_score = $3,
       result_first_seen_at = now() - interval '11 minutes', result_confirmed_at = now()
     where id = $1`,
    [matchId, home, away],
  );
  await pool.query(`update public.markets set status = 'CLOSED' where match_id = $1`, [matchId]);
  const r = await pool.query(
    `select public.settle_market(id) as s from public.markets where match_id = $1`,
    [matchId],
  );
  if (r.rows[0]?.s !== "RESOLVED") throw new Error(`settle_market: ${String(r.rows[0]?.s)}`);
}

export async function ledger(
  userId: string,
): Promise<{ balance: number; debits: number; bets: number }> {
  const r = await pool.query(
    `select (select balance from public.wallets where user_id = $1)::int as balance,
            (select count(*) from public.wallet_entries where user_id = $1 and kind = 'STAKE_DEBIT')::int as debits,
            (select count(*) from public.bets where user_id = $1)::int as bets`,
    [userId],
  );
  return r.rows[0] as { balance: number; debits: number; bets: number };
}
