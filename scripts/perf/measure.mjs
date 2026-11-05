// Измерения этапа 10 (CLAUDE.md §14). Запуск: verify.ps1 -Measure (сам поднимает сервер).
// 1) Профиль данных в ЛОКАЛЬНОЙ БД под поставщиком "perf": 50 пользователей, 2 000 матчей,
//    10 000 прогнозов, половина рассчитана. Создается один раз (повторно — пропускается).
// 2) Время функций БД под ролями anon/authenticated (как через PostgREST, без HTTP).
// 3) HTTP p50/p95 к локальному production-серверу (next start) и холодный старт.
// 4) Мобильный LCP (Pixel 5, 360px, CPU x4, «медленный 4G») и объем JS.
// Результат: .verify/perf.json. Пароль БД — стандартный локальный, не секрет.
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { chromium, devices } from "@playwright/test";
import pg from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BASE = process.env.MEASURE_BASE_URL ?? "http://localhost:3200";
const SERVER_STARTED_AT = Number(process.env.MEASURE_SERVER_STARTED_AT ?? "0");
const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 20 });
const results = {
  startedAt: new Date().toISOString(),
  environment: {},
  profile: {},
  db: {},
  http: {},
  coldStart: {},
  mobile: {},
};

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const r = (v) => Math.round(v * 10) / 10;
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]) };
}

async function timed(n, concurrency, fn) {
  const samples = [];
  let next = 0;
  async function worker() {
    while (next < n) {
      const i = next++;
      const t = performance.now();
      await fn(i);
      samples.push(performance.now() - t);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return stats(samples);
}

// ------------------------------------------------------------------ профиль данных
async function seedProfile() {
  const exists = await pool.query(
    "select count(*)::int c from public.matches where provider = 'perf'",
  );
  if (exists.rows[0].c > 0) {
    return false;
  }
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`
      insert into public.competitions (provider, provider_id, code, name, enabled)
      select 'perf', 'c' || n, 'P' || n, 'Нагрузочная лига ' || n, true from generate_series(1, 4) n;
      insert into public.teams (provider, provider_id, name)
      select 'perf', 't' || n, 'Команда ' || n from generate_series(1, 40) n;
      with comp as (select id, row_number() over (order by provider_id) rn from public.competitions where provider = 'perf'),
           team as (select id, row_number() over (order by provider_id::text) rn from public.teams where provider = 'perf')
      insert into public.matches (provider, provider_id, competition_id, home_team_id, away_team_id, kickoff_at, status,
                                  regulation_home_score, regulation_away_score, result_kind, last_seen_at)
      select 'perf', 'm' || g, comp.id, h.id, a.id,
             now() - interval '30 days' + g * interval '43 minutes',
             case when now() - interval '30 days' + g * interval '43 minutes' < now() - interval '3 hours'
                  then 'FINISHED' else 'SCHEDULED' end::public.match_status,
             case when now() - interval '30 days' + g * interval '43 minutes' < now() - interval '3 hours' then g % 4 end,
             case when now() - interval '30 days' + g * interval '43 minutes' < now() - interval '3 hours' then g % 3 end,
             case when now() - interval '30 days' + g * interval '43 minutes' < now() - interval '3 hours'
                  then 'REGULAR' else 'NONE' end::public.match_result_kind,
             now()
      from generate_series(1, 2000) g
      join comp on comp.rn = 1 + g % 4
      join team h on h.rn = 1 + g % 40
      join team a on a.rn = 1 + (g + 7) % 40;
      insert into public.markets (match_id, type, status, quote_version, model_version, home_odds_milli, draw_odds_milli, away_odds_milli)
      select id, 'MATCH_RESULT_1X2', 'OPEN', 1, 'demo-v1', 1800 + (hashtext(id::text) & 1023), 3200, 4100
      from public.matches where provider = 'perf';
      insert into auth.users (id, email, raw_user_meta_data)
      select gen_random_uuid(), 'perf' || n || '@perf.local', jsonb_build_object('user_name', 'perf_user_' || n)
      from generate_series(1, 50) n;
    `);
    await c.query(`
      do $$ declare u record; begin
        for u in select id from auth.users where email like '%@perf.local' loop
          perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
          perform set_config('role', 'authenticated', true);
          -- Профиль, кошелек и стартовый кредит создаются при выборе псевдонима (ADR-075).
          perform public.set_pseudonym('Perf ' || substr(replace(u.id::text, '-', ''), 1, 10));
          perform set_config('role', 'postgres', true);
        end loop;
      end $$;
    `);
    // 10 000 прогнозов: каждому пользователю 200 рынков своего класса (номер матча по модулю 10).
    await c.query(`
      create temporary table perf_bets on commit drop as
      with u as (select id, row_number() over (order by email) - 1 as un from auth.users where email like '%@perf.local'),
           k as (select k.id, k.home_odds_milli, k.draw_odds_milli, k.away_odds_milli,
                        substr(m.provider_id, 2)::int as g
                 from public.markets k join public.matches m on m.id = k.match_id where m.provider = 'perf')
      select gen_random_uuid() as id, u.id as user_id, k.id as market_id,
             (array['HOME','DRAW','AWAY'])[1 + (k.g + u.un) % 3]::public.bet_outcome as outcome,
             (10 + (k.g % 5) * 10)::bigint as stake,
             case (k.g + u.un) % 3 when 0 then k.home_odds_milli when 1 then k.draw_odds_milli else k.away_odds_milli end as odds
      from u join k on k.g % 10 = u.un % 10;
      insert into public.bets (id, user_id, market_id, outcome, stake, accepted_odds_milli, potential_payout,
                               idempotency_key, request_hash, created_at)
      select id, user_id, market_id, outcome, stake, odds, (stake * odds) / 1000, gen_random_uuid(), md5(id::text),
             now() - interval '31 days'
      from perf_bets;
      insert into public.wallet_entries (user_id, kind, amount, bet_id, operation_key)
      select user_id, 'STAKE_DEBIT', -stake, id, 'perf-stake:' || id from perf_bets;
      update public.wallets w set balance = w.balance - s.total
      from (select user_id, sum(stake) total from perf_bets group by user_id) s where s.user_id = w.user_id;
    `);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  // Расчет прошедших матчей (как это сделал бы конвейер).
  await pool.query(`
    update public.markets k set status = 'CLOSED' from public.matches m
    where m.id = k.match_id and m.provider = 'perf' and m.status = 'FINISHED';
    update public.matches set result_first_seen_at = now() - interval '11 minutes', result_confirmed_at = now()
    where provider = 'perf' and status = 'FINISHED';
  `);
  const ids = await pool.query(
    "select k.id from public.markets k join public.matches m on m.id = k.match_id where m.provider = 'perf' and k.status = 'CLOSED'",
  );
  for (const row of ids.rows) await pool.query("select public.settle_market($1)", [row.id]);
  return true;
}

async function profileCounts() {
  const r = await pool.query(`
    select (select count(*) from public.matches where provider = 'perf')::int matches,
           (select count(*) from public.bets b join public.markets k on k.id = b.market_id
              join public.matches m on m.id = k.match_id where m.provider = 'perf')::int bets,
           (select count(*) from public.bets b join public.markets k on k.id = b.market_id
              join public.matches m on m.id = k.match_id where m.provider = 'perf' and b.status <> 'PENDING')::int settled_bets,
           (select count(*) from auth.users where email like '%@perf.local')::int users,
           (select count(*) from public.matches)::int all_matches,
           (select count(*) from public.bets)::int all_bets`);
  return r.rows[0];
}

// ------------------------------------------------------------------ БД
function asAnon(sql) {
  return `begin; set local role anon; ${sql}; commit;`;
}
function asUser(id, sql) {
  const claims = JSON.stringify({ sub: id, role: "authenticated" });
  return `begin; set local role authenticated; select set_config('request.jwt.claims', ${lit(claims)}, true); ${sql}; commit;`;
}

async function measureDb() {
  // Свежесть данных: прием прогнозов закрыт, если матч не обновлялся больше часа.
  await pool.query(
    "update public.matches set last_seen_at = now() where provider = 'perf' and status = 'SCHEDULED'",
  );
  const users = (
    await pool.query("select id from auth.users where email like '%@perf.local' order by email")
  ).rows.map((r) => r.id);
  const open = (
    await pool.query(`
    select k.id, substr(m.provider_id, 2)::int g from public.markets k join public.matches m on m.id = k.match_id
    where m.provider = 'perf' and k.status = 'OPEN' and m.kickoff_at > now() + interval '1 hour' order by m.kickoff_at`)
  ).rows;

  const db = {};
  db.list_matches_open = await timed(300, 10, () =>
    pool.query(
      asAnon("select * from public.list_matches('perf', null, null, null, 'open', null, null, 20)"),
    ),
  );
  db.list_matches_all_page = await timed(300, 10, () =>
    pool.query(
      asAnon("select * from public.list_matches('perf', null, null, null, 'all', null, null, 20)"),
    ),
  );
  db.list_my_bets = await timed(300, 10, (i) =>
    pool.query(
      asUser(users[i % users.length], "select * from public.list_my_bets(null, null, null, 20)"),
    ),
  );
  db.my_stats = await timed(300, 10, (i) =>
    pool.query(asUser(users[i % users.length], "select * from public.my_stats()")),
  );
  db.leaderboard = await timed(200, 10, () =>
    pool.query(asAnon("select * from public.leaderboard(50)")),
  );

  // place_bet: каждый пользователь ставит на рынки «чужого» класса (своих прогнозов там нет).
  // Лимит — 10 попыток в минуту на пользователя, поэтому 4 прогноза на каждого из 50.
  const tasks = [];
  for (let u = 0; u < users.length; u++) {
    const own = open.filter((k) => k.g % 10 === (u + 5) % 10);
    for (let j = 0; j < 4 && j < own.length; j++)
      tasks.push({ user: users[u], market: own[(j * 7 + u) % own.length].id });
  }
  const outcomes = {};
  db.place_bet = await timed(tasks.length, 10, async (i) => {
    const t = tasks[i];
    const r = await pool.query(
      asUser(
        t.user,
        `select public.place_bet(${lit(t.market)}, 'HOME', 10, 1, ${lit(randomUUID())}) as r`,
      ),
    );
    const res = r.filter((x) => x.command === "SELECT").at(-1)?.rows?.[0]?.r;
    const key = res?.ok ? "ok" : (res?.code ?? "unknown");
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  });
  db.place_bet.outcomes = outcomes;
  return db;
}

// ------------------------------------------------------------------ HTTP
async function get(path) {
  const t = performance.now();
  const res = await fetch(BASE + path, { redirect: "manual" });
  await res.arrayBuffer();
  return { ms: performance.now() - t, status: res.status };
}

async function measureHttp() {
  const http = {};
  const targets = {
    "GET /api/v1/matches": "/api/v1/matches",
    "GET /matches (страница)": "/matches",
    "GET /api/v1/leaderboard": "/api/v1/leaderboard",
    "GET /leaderboard (страница)": "/leaderboard",
    "GET /matches/[id] (страница)": null,
  };
  const list = await (await fetch(BASE + "/api/v1/matches?scope=all")).json();
  const firstId = list?.data?.items?.[0]?.id;
  if (firstId) targets["GET /matches/[id] (страница)"] = `/matches/${firstId}`;
  for (const [name, path] of Object.entries(targets)) {
    if (!path) continue;
    for (let i = 0; i < 5; i++) await get(path); // прогрев
    const statuses = {};
    const s = await timed(200, 10, async () => {
      const r = await get(path);
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    });
    http[name] = { ...s, statuses };
  }
  return http;
}

async function measureColdStart() {
  // Сервер запущен verify.ps1 непосредственно перед скриптом; первый запрос страницы — до прогрева.
  const cold = {};
  if (SERVER_STARTED_AT > 0) {
    cold.readyAfterSpawnMs = Number(process.env.MEASURE_READY_AT ?? 0) - SERVER_STARTED_AT;
  }
  cold.firstMatchesPageMs = Math.round((await get("/matches")).ms);
  cold.secondMatchesPageMs = Math.round((await get("/matches")).ms);
  return cold;
}

// ------------------------------------------------------------------ мобильный LCP
async function measureMobile() {
  const browser = await chromium.launch();
  const mobile = {};
  try {
    for (const path of ["/", "/matches", "/leaderboard"]) {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const context = await browser.newContext({
          ...devices["Pixel 5"],
          viewport: { width: 360, height: 740 },
        });
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 150,
          downloadThroughput: (1.6 * 1024 * 1024) / 8,
          uploadThroughput: (750 * 1024) / 8,
        });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.addInitScript(() => {
          window.__lcp = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) window.__lcp = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        });
        let jsBytes = 0;
        page.on("requestfinished", async (req) => {
          if (req.resourceType() === "script") {
            try {
              jsBytes += (await req.sizes()).responseBodySize;
            } catch {}
          }
        });
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        const lcp = await page.evaluate(() => window.__lcp);
        runs.push({ lcpMs: Math.round(lcp), jsKb: Math.round(jsBytes / 1024) });
        await context.close();
      }
      const sorted = [...runs].sort((a, b) => a.lcpMs - b.lcpMs);
      mobile[path] = { medianLcpMs: sorted[1].lcpMs, runs };
    }
  } finally {
    await browser.close();
  }
  return mobile;
}

// ------------------------------------------------------------------
async function main() {
  results.environment = {
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    base: BASE,
    note: "локально: next start (production build) + локальный Supabase в Docker на той же машине",
  };
  results.coldStart = await measureColdStart();
  console.log("cold start:", JSON.stringify(results.coldStart));
  const seededNow = await seedProfile();
  results.profile = { ...(await profileCounts()), seededNow };
  console.log("profile:", JSON.stringify(results.profile));
  results.db = await measureDb();
  console.log("db:", JSON.stringify(results.db));
  results.http = await measureHttp();
  console.log("http:", JSON.stringify(results.http));
  results.mobile = await measureMobile();
  console.log("mobile:", JSON.stringify(results.mobile));
  results.finishedAt = new Date().toISOString();
  mkdirSync(".verify", { recursive: true });
  writeFileSync(".verify/perf.json", JSON.stringify(results, null, 2));
  console.log("written .verify/perf.json");
}

main()
  .catch((e) => {
    console.error("measure failed:", e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
