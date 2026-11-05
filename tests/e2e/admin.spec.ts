import { expect, test } from "@playwright/test";

// Демо-режим: админки нет вовсе — раздел и API не раскрываются (404).

test("страница админки в демо — 404", async ({ page }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("admin API в демо — 404 и без кеша", async ({ request }) => {
  const jobs = await request.get("/api/admin/jobs");
  expect(jobs.status()).toBe(404);
  expect(jobs.headers()["cache-control"]).toContain("no-store");

  const sync = await request.post("/api/admin/sync", { data: {} });
  expect(sync.status()).toBe(404);

  const conflicts = await request.post("/api/admin/conflicts", {
    data: { matchId: "0b6f2f0e-1111-4222-8333-944444444444", note: "проверка" },
  });
  expect(conflicts.status()).toBe(404);
});

test("ссылки на админку нет в шапке", async ({ page }) => {
  await page.goto("/");
  await expect(
    page
      .getByRole("navigation", { name: "Основная навигация" })
      .getByRole("link", { name: /Админ/ }),
  ).toHaveCount(0);
});
