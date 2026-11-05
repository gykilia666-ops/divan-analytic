import { expect, test } from "@playwright/test";

// Демо-режим: аккаунта нет — страница требует входа, API удаления недоступно.

test("страница аккаунта без входа ведет на вход", async ({ page }) => {
  await page.goto("/my/account");
  await expect(page).toHaveURL(/\/login\?next=%2Fmy%2Faccount$/);
});

test("API удаления аккаунта в демо — 404 без кеша", async ({ request }) => {
  const res = await request.delete("/api/v1/me/account", { data: { confirm: "x" } });
  expect(res.status()).toBe(404);
  expect(res.headers()["cache-control"]).toContain("no-store");
});
