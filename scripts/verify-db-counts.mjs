// Сводка по матчам в локальной БД после синхронизации (для scripts/verify.ps1).
// Пароль — стандартный для локального Supabase CLI, не секрет.
import pg from "pg";

const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
});
await client.connect();
try {
  const { rows } = await client.query(`
    select m.provider, c.code, count(*)::int as matches,
           count(*) filter (where m.result_kind = 'REGULAR')::int as with_result,
           count(distinct m.home_team_id)::int as home_teams
    from public.matches m join public.competitions c on c.id = m.competition_id
    group by m.provider, c.code order by m.provider, c.code`);
  console.table(rows);
  const dup = await client.query(`
    select count(*)::int as n from (
      select provider, provider_id from public.matches group by 1, 2 having count(*) > 1) d`);
  console.log(`duplicate matches: ${dup.rows[0].n}`);
} finally {
  await client.end();
}
