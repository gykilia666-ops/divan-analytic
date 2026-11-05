import { expect, test } from "@playwright/test";

// Демо-режим: рейтинг из вымышленных игроков, личная статистика требует входа.

test("рейтинг в демо: допущенные игроки по порядку, пометка демо-данных", async ({ page }) => {
  await page.goto("/leaderboard");
  await expect(page.getByRole("heading", { level: 1, name: "Рейтинг" })).toBeVisible();
  await expect(page.getByTestId("leaderboard-demo")).toBeVisible();
  const rows = page.getByTestId("leaderboard-row");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Тактик_с_дивана");
  await expect(rows.nth(0)).toContainText("+280");
  await expect(rows.nth(1)).toContainText("Фанат_ничьих");
  await expect(rows.nth(2)).toContainText("−40");
  await expect(page.getByText("Новичок")).toHaveCount(0);
  await expect(page.getByText("Скрытый")).toHaveCount(0);
});

test("рейтинг без горизонтальной прокрутки страницы", async ({ page }) => {
  await page.goto("/leaderboard");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("ссылка на рейтинг есть в шапке", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Рейтинг" })
    .click();
  await expect(page).toHaveURL(/\/leaderboard$/);
});

test("API рейтинга: безопасный DTO и общий кеш 60 секунд", async ({ request }) => {
  const res = await request.get("/api/v1/leaderboard");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("s-maxage=60");
  const body = await res.json();
  expect(body.meta.source).toBe("demo");
  expect(body.data.minSettled).toBe(5);
  expect(body.data.entries).toHaveLength(3);
  for (const entry of body.data.entries) {
    expect(Object.keys(entry).sort()).toEqual(
      [
        "avatarUrl",
        "displayName",
        "netProfit",
        "place",
        "roi",
        "settled",
        "stakes",
        "winRate",
        "won",
      ].sort(),
    );
  }
});

test("моя статистика без входа ведет на страницу входа", async ({ page }) => {
  await page.goto("/my/stats");
  await expect(page).toHaveURL(/\/login\?next=%2Fmy%2Fstats$/);
});

test("API статистики без входа — 401", async ({ request }) => {
  const res = await request.get("/api/v1/me/stats");
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toContain("no-store");
});
