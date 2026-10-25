import { expect, test } from "@playwright/test";

test("главная: назначение, дисклеймер, демо-метка", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Диванный аналитик" })).toBeVisible();
  await expect(page.getByTestId("disclaimer")).toContainText("Монеты не имеют денежной стоимости");
  await expect(page.getByTestId("mode-banner")).toContainText("ДЕМО-РЕЖИМ");
});

test("переход на матчи: все 12 демо-сценариев, статус текстом", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Посмотреть матчи" }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await expect(page.getByTestId("match-card")).toHaveCount(12);
  await expect(page.getByText("Статус: Отменён")).toBeVisible();
  // Зона времени указана явно (после гидратации — зона браузера).
  await expect(page.locator("time").first()).toContainText(/\(.+\)/);
});

test("правила и приватность открываются", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByRole("heading", { name: "Правила" })).toBeVisible();
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Приватность" })).toBeVisible();
});

test("health минимален и без кеширования", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.data).toEqual({ status: "ok" });
  expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
});

test("несуществующая страница даёт понятный 404", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
});

test("security headers выставлены", async ({ request }) => {
  const res = await request.get("/");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
});
