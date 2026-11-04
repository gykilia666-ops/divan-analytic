import { expect, test } from "@playwright/test";

// Демо-режим: прогнозы не принимаются, личные разделы требуют входа.

test("страница матча в демо объясняет, что прогнозы не принимаются", async ({ page }) => {
  await page.goto("/matches/demo-001");
  await expect(page.getByTestId("bet-panel-demo")).toBeVisible();
  await expect(page.getByRole("form", { name: "Купон" })).toHaveCount(0);
});

test("POST /api/v1/bets в демо — 503 по контракту", async ({ request }) => {
  const res = await request.post("/api/v1/bets", {
    data: {
      marketId: "0b6f2f0e-1111-4222-8333-944444444444",
      outcome: "HOME",
      stake: 100,
      quoteVersion: 1,
      idempotencyKey: "1b6f2f0e-1111-4222-8333-944444444444",
    },
  });
  expect(res.status()).toBe(503);
  expect((await res.json()).error.code).toBe("SERVICE_UNAVAILABLE");
});

test("GET запрещен для команды прогноза", async ({ request }) => {
  const res = await request.get("/api/v1/bets");
  expect(res.status()).toBe(405);
});

test("история прогнозов без входа ведет на страницу входа", async ({ page }) => {
  await page.goto("/my/bets");
  await expect(page).toHaveURL(/\/login\?next=%2Fmy%2Fbets$/);
});

test("API истории без входа — 401", async ({ request }) => {
  const res = await request.get("/api/v1/me/bets");
  expect(res.status()).toBe(401);
});
