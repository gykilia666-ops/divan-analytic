// Облачные измерения (docs/requirements.md §14.2) — ТОЛЬКО ЧТЕНИЕ: никаких записей в production БД (§19.1).
// Запуск с компьютера владельца:  node scripts/perf/measure-cloud.mjs https://divan-analytic.vercel.app
// Нагрузка бережная (по 60 запросов, параллельность 3), чтобы не расходовать квоты бесплатных тарифов.
// Числа включают сеть от вашего компьютера до Vercel (lhr1) — это задержка, которую видит пользователь.
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { chromium, devices } from "@playwright/test";

const BASE = (process.argv[2] ?? "https://divan-analytic.vercel.app").replace(/\/$/, "");
const out = {
  base: BASE,
  startedAt: new Date().toISOString(),
  environment: {},
  first: {},
  http: {},
  mobile: {},
  interaction: {},
};

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const r = (v) => Math.round(v);
  return { n: s.length, p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]) };
}

async function get(path) {
  const t = performance.now();
  const res = await fetch(BASE + path, {
    redirect: "manual",
    headers: { "user-agent": "divan-measure/1" },
  });
  await res.arrayBuffer();
  return {
    ms: performance.now() - t,
    status: res.status,
    cache: res.headers.get("x-vercel-cache"),
  };
}

async function timed(path, n, concurrency) {
  const samples = [];
  const statuses = {};
  const caches = {};
  let next = 0;
  async function worker() {
    while (next < n) {
      next++;
      const r = await get(path);
      samples.push(r.ms);
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      if (r.cache) caches[r.cache] = (caches[r.cache] ?? 0) + 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { ...stats(samples), statuses, vercelCache: caches };
}

const PATHS = {
  "GET /api/health": "/api/health",
  "GET /api/v1/matches": "/api/v1/matches",
  "GET /matches": "/matches",
  "GET /api/v1/leaderboard": "/api/v1/leaderboard",
  "GET /leaderboard": "/leaderboard",
};

async function main() {
  out.environment = {
    node: process.version,
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model?.trim(),
  };

  // Первый запрос после простоя — приближение холодного старта (если функция успела «остыть»).
  for (const [name, path] of Object.entries(PATHS))
    out.first[name] = Math.round((await get(path)).ms);
  console.log("first:", JSON.stringify(out.first));

  for (const [name, path] of Object.entries(PATHS)) {
    out.http[name] = await timed(path, 60, 3);
    console.log(name, JSON.stringify(out.http[name]));
  }

  const browser = await chromium.launch();
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
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        await page.addInitScript(() => {
          window.__lcp = 0;
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) window.__lcp = e.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
        });
        await page.goto(BASE + path, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        runs.push(Math.round(await page.evaluate(() => window.__lcp)));
        await context.close();
      }
      const sorted = [...runs].sort((a, b) => a - b);
      out.mobile[path] = { medianLcpMs: sorted[1], runs };
      console.log("LCP", path, JSON.stringify(out.mobile[path]));
    }

    // Реакция интерфейса: длительность обработки взаимодействий (Event Timing, как INP) на /matches.
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__events = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries())
          window.__events.push({ name: e.name, duration: e.duration });
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    });
    await page.goto(BASE + "/matches", { waitUntil: "networkidle" });
    const selects = page.locator("select");
    const count = await selects.count();
    for (let i = 0; i < count; i++) {
      const sel = selects.nth(i);
      const values = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value));
      if (values.length > 1) await sel.selectOption(values[1] ?? values[0]);
    }
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1000);
    const events = await page.evaluate(() => window.__events);
    out.interaction = {
      page: "/matches (смена фильтров, Tab)",
      eventsOver16ms: events.length,
      maxEventDurationMs: events.reduce((m, e) => Math.max(m, e.duration), 0),
      note: "Event Timing учитывает события длительностью ≥ 16 мс; 0 событий = все реакции быстрее 16 мс",
    };
    console.log("interaction", JSON.stringify(out.interaction));
    await context.close();
  } finally {
    await browser.close();
  }

  out.finishedAt = new Date().toISOString();
  mkdirSync(".verify", { recursive: true });
  writeFileSync(".verify/perf-cloud.json", JSON.stringify(out, null, 2));
  console.log("written .verify/perf-cloud.json");
}

main().catch((e) => {
  console.error("measure-cloud failed:", e?.message ?? e);
  process.exitCode = 1;
});
