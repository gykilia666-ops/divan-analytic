// Разовая проверка football-data.org (docs/requirements.md, этапы 0 и 4): токен, доступные соревнования,
// фильтры дат, форма счета. Токен берется из окружения и НЕ печатается.
// Запуск: node --env-file=.env.local scripts/probe-football-data.mjs
// Делает 5 запросов (лимит бесплатного тарифа — 10 в минуту).

const BASE = "https://api.football-data.org/v4";
const token = process.env.FOOTBALL_DATA_API_KEY;

if (!token || token.startsWith("replace-me")) {
  console.error("FOOTBALL_DATA_API_KEY не задан в .env.local");
  process.exit(1);
}

const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function call(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Auth-Token": token } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return {
    path,
    status: res.status,
    requestsAvailableMinute: res.headers.get("x-requests-available-minute"),
    counterReset: res.headers.get("x-requestcounter-reset"),
    body,
  };
}

function brief(match) {
  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,
    stage: match.stage,
    lastUpdated: match.lastUpdated,
    home: match.homeTeam?.name,
    away: match.awayTeam?.name,
    score: match.score,
  };
}

const out = {};

const comps = await call("/competitions");
out.competitions = {
  status: comps.status,
  rate: [comps.requestsAvailableMinute, comps.counterReset],
  count: comps.body?.count ?? null,
  list: (comps.body?.competitions ?? []).map((c) => ({
    code: c.code,
    id: c.id,
    name: c.name,
    type: c.type,
    plan: c.plan,
  })),
  error: comps.status === 200 ? undefined : JSON.stringify(comps.body).slice(0, 300),
};

out.upcoming = {};
for (const code of ["PL", "BL1", "PD"]) {
  const r = await call(`/competitions/${code}/matches?dateFrom=${day(0)}&dateTo=${day(10)}`);
  const matches = r.body?.matches ?? [];
  out.upcoming[code] = {
    status: r.status,
    path: r.path,
    count: r.body?.resultSet?.count ?? matches.length,
    filtersEcho: r.body?.filters ?? null,
    statuses: [...new Set(matches.map((m) => m.status))],
    first: matches[0] ? brief(matches[0]) : null,
    error: r.status === 200 ? undefined : JSON.stringify(r.body).slice(0, 300),
  };
}

const fin = await call(
  `/competitions/PL/matches?status=FINISHED&dateFrom=${day(-10)}&dateTo=${day(0)}`,
);
const finished = fin.body?.matches ?? [];
out.finishedPL = {
  status: fin.status,
  path: fin.path,
  count: finished.length,
  durations: [...new Set(finished.map((m) => m.score?.duration))],
  samples: finished.slice(0, 2).map(brief),
  rate: [fin.requestsAvailableMinute, fin.counterReset],
  error: fin.status === 200 ? undefined : JSON.stringify(fin.body).slice(0, 300),
};

console.log(JSON.stringify(out, null, 2));
