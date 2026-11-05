import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ORIGIN } from "./env";
import {
  createOpenMarket,
  createUser,
  finishAndSettle,
  ledger,
  loginAs,
  pool,
  pseudonym,
} from "./support";

// Полный путь пользователя в режиме connected (docs/testing-strategy.md, п. 1): то, что раньше
// проверялось только вручную. Деньги сверяются и в интерфейсе, и прямо в БД.

test.afterAll(async () => {
  await pool.end();
});

async function choosePseudonym(page: Page, name: string): Promise<void> {
  await page.goto("/my/pseudonym?next=%2Fmatches");
  await page.getByRole("textbox", { name: "Псевдоним", exact: true }).fill(name);
  await page.getByRole("button", { name: "Выбрать псевдоним" }).click();
  await expect(page).toHaveURL(/\/matches/);
}

test("новый пользователь: без псевдонима прогноз недоступен, после выбора — 10 000 монет", async ({
  page,
  context,
}) => {
  const user = await createUser();
  await loginAs(context, user);
  const { matchId } = await createOpenMarket();

  await page.goto(`/matches/${matchId}`);
  await expect(page.getByTestId("bet-panel-pseudonym")).toBeVisible();
  await expect(page.getByRole("form", { name: "Купон" })).toHaveCount(0);
  expect((await ledger(user.id)).balance).toBeNull();

  const name = pseudonym();
  await choosePseudonym(page, name);
  await expect(page.getByTestId("user-name")).toHaveText(name);
  await page.goto("/my/wallet");
  await expect(page.getByTestId("wallet-balance")).toHaveText("10 000");
});

test("прогноз: двойной клик списывает один раз; расчет, статистика и рейтинг", async ({
  page,
  context,
}) => {
  const user = await createUser();
  await loginAs(context, user);
  await choosePseudonym(page, pseudonym());

  // Первый прогноз — через интерфейс, с двойным нажатием «Подтвердить».
  const first = await createOpenMarket();
  await page.goto(`/matches/${first.matchId}`);
  await page.getByRole("radio", { name: /Победа хозяев/ }).check();
  const confirm = page.getByRole("button", { name: "Подтвердить прогноз" });
  await confirm.dblclick();
  await expect(page.getByTestId("coupon-success")).toBeVisible();
  expect(await ledger(user.id)).toEqual({ balance: 9900, debits: 1, bets: 1 });

  await page.goto("/my/wallet");
  await expect(page.getByTestId("wallet-balance")).toHaveText("9 900");
  await expect(
    page.getByTestId("wallet-entry").filter({ hasText: "Списание за прогноз" }),
  ).toHaveCount(1);

  // Еще четыре прогноза — через API от имени того же пользователя (тот же Origin, та же cookie).
  const others = [
    await createOpenMarket(),
    await createOpenMarket(),
    await createOpenMarket(),
    await createOpenMarket(),
  ];
  for (const m of others) {
    const res = await page.request.post("/api/v1/bets", {
      headers: { origin: E2E_ORIGIN },
      data: {
        marketId: m.marketId,
        outcome: "HOME",
        stake: 100,
        quoteVersion: 1,
        idempotencyKey: randomUUID(),
      },
    });
    expect(res.status()).toBe(201);
  }
  expect(await ledger(user.id)).toEqual({ balance: 9500, debits: 5, bets: 5 });

  // Итоги: три победы хозяев (выплата 200), два поражения.
  await finishAndSettle(first.matchId, 2, 0);
  await finishAndSettle(others[0]!.matchId, 1, 0);
  await finishAndSettle(others[1]!.matchId, 3, 1);
  await finishAndSettle(others[2]!.matchId, 0, 1);
  await finishAndSettle(others[3]!.matchId, 1, 2);
  expect((await ledger(user.id)).balance).toBe(10100);

  await page.goto("/my/bets?status=WON");
  await expect(page.getByTestId("bet-item")).toHaveCount(3);
  await page.goto("/my/stats");
  await expect(page.getByTestId("stats-settled")).toHaveText("5");
  await expect(page.getByTestId("stats-won")).toHaveText("3");
  await expect(page.getByTestId("stats-profit")).toHaveText("+100");
  await expect(page.getByTestId("stats-win-rate")).toHaveText("60,0 %");
  await expect(page.getByTestId("stats-roi")).toHaveText("20,0 %");
  await expect(page.getByTestId("stats-place")).toContainText(/Место в рейтинге: \d+/);
});

test("повтор того же запроса (тот же ключ) не создает второй прогноз", async ({
  page,
  context,
}) => {
  const user = await createUser();
  await loginAs(context, user);
  await choosePseudonym(page, pseudonym());
  const { marketId } = await createOpenMarket();
  const data = {
    marketId,
    outcome: "DRAW",
    stake: 50,
    quoteVersion: 1,
    idempotencyKey: randomUUID(),
  };

  const a = await page.request.post("/api/v1/bets", { headers: { origin: E2E_ORIGIN }, data });
  const b = await page.request.post("/api/v1/bets", { headers: { origin: E2E_ORIGIN }, data });
  expect(a.status()).toBe(201);
  expect(b.status()).toBe(200);
  expect((await b.json()).data.replay).toBe(true);
  expect(await ledger(user.id)).toEqual({ balance: 9950, debits: 1, bets: 1 });
});

test("обычному пользователю админка и ее API закрыты", async ({ page, context }) => {
  const user = await createUser();
  await loginAs(context, user);
  await choosePseudonym(page, pseudonym());

  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  const sync = await page.request.post("/api/admin/sync", {
    headers: { origin: E2E_ORIGIN },
    data: {},
  });
  expect(sync.status()).toBe(403);
  const jobs = await page.request.get("/api/admin/jobs");
  expect(jobs.status()).toBe(403);
});

test("удаление аккаунта: выход, профиль обезличен, журнал сохранен", async ({ page, context }) => {
  const user = await createUser();
  await loginAs(context, user);
  const name = pseudonym();
  await choosePseudonym(page, name);

  await page.goto("/my/account");
  await page.getByLabel(/Для подтверждения введите/).fill(name);
  await page.getByRole("button", { name: "Удалить аккаунт навсегда" }).click();
  await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
  await expect(page.getByTestId("user-name")).toHaveCount(0);

  const profile = await pool.query(
    "select display_name, deleted_at is not null as deleted from public.profiles where id = $1",
    [user.id],
  );
  expect(profile.rows[0]).toMatchObject({ deleted: true });
  expect(profile.rows[0].display_name).not.toBe(name);
  const credit = await pool.query(
    "select count(*)::int as n from public.wallet_entries where user_id = $1 and kind = 'INITIAL_CREDIT'",
    [user.id],
  );
  expect(credit.rows[0].n).toBe(1);

  // Старая cookie больше не дает доступа к личным разделам.
  const me = await page.request.get("/api/v1/me/stats");
  expect([401, 503]).toContain(me.status());
});
