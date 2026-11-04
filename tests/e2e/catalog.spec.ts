import { expect, test } from "@playwright/test";

// Демо-режим: фиксированное «сейчас» = 2026-10-26T12:00Z, 12 вымышленных матчей.

const card = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("listitem", { name });

test("карточки показывают коэффициенты и состояние приема", async ({ page }) => {
  await page.goto("/matches");
  const upcoming = card(page, "Сибирский Север — Енисей-Резерв");
  await expect(upcoming.getByTestId("odds-home")).toHaveText(/^\d+\.\d{2}$/);
  await expect(upcoming.getByTestId("acceptance")).toHaveAttribute("data-reason", "OPEN");

  // Рынок еще открыт, но до старта 3 минуты — прием закрыт временем.
  await expect(card(page, "Красный Диван — Пикник-Сити").getByTestId("acceptance")).toHaveAttribute(
    "data-reason",
    "CUTOFF",
  );
  await expect(
    card(page, "Заброшенный Стадион — Давние Данные").getByTestId("acceptance"),
  ).toHaveAttribute("data-reason", "STALE");
});

test("коэффициенты детерминированы между загрузками", async ({ page }) => {
  await page.goto("/matches");
  const before = await page.getByTestId("odds-home").allTextContents();
  await page.reload();
  expect(await page.getByTestId("odds-home").allTextContents()).toEqual(before);
});

test("фильтр: предстоящие и завершенные", async ({ page }) => {
  await page.goto("/matches?scope=upcoming");
  await expect(page.getByTestId("match-card")).toHaveCount(5);
  await page.goto("/matches?scope=finished");
  await expect(page.getByTestId("match-card")).toHaveCount(7);
});

test("форма фильтров работает без ручного ввода адреса", async ({ page }) => {
  await page.goto("/matches");
  await page.getByLabel("Матчи").selectOption("finished");
  await page.getByRole("button", { name: "Показать" }).click();
  await expect(page).toHaveURL(/scope=finished/);
  await expect(page.getByTestId("match-card")).toHaveCount(7);
});

test("выбранная зона Asia/Krasnoyarsk: время и фильтр даты в ней", async ({ page }) => {
  await page.goto("/matches?tz=Asia%2FKrasnoyarsk&date=2026-10-26");
  await expect(page.getByTestId("timezone-label")).toContainText("Asia/Krasnoyarsk");
  await expect(page.getByTestId("match-card")).toHaveCount(5);
  await expect(page.locator("time").first()).toContainText("(Asia/Krasnoyarsk)");
});

test("пустой результат и сброс фильтров", async ({ page }) => {
  await page.goto("/matches?date=2030-01-01");
  await expect(page.getByTestId("matches-empty")).toBeVisible();
  await page.getByRole("link", { name: "Сбросить фильтры" }).click();
  await expect(page.getByTestId("match-card")).toHaveCount(12);
});

test("пагинация", async ({ page }) => {
  const cards = page.getByTestId("match-card");
  await page.goto("/matches?limit=5");
  await expect(cards).toHaveCount(5);
  const firstOfPage1 = await cards.first().getAttribute("aria-label");

  await page.getByTestId("next-page").click();
  // На обеих страницах по 5 карточек: ждем, пока сменится содержимое, а не только число.
  await expect(cards.first()).not.toHaveAttribute("aria-label", firstOfPage1 ?? "");
  await expect(cards).toHaveCount(5);

  await page.getByTestId("next-page").click();
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId("next-page")).toHaveCount(0);
});

test("страница матча", async ({ page }) => {
  await page.goto("/matches");
  await page.getByRole("link", { name: /Сибирский Север/ }).click();
  await expect(page).toHaveURL(/\/matches\/demo-001/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Сибирский Север");
  await expect(page.getByTestId("odds-draw")).toHaveText(/^\d+\.\d{2}$/);
  await expect(page.getByTestId("acceptance")).toHaveAttribute("data-reason", "OPEN");
});

test("несуществующий матч — 404", async ({ page }) => {
  const res = await page.goto("/matches/nope");
  expect(res?.status()).toBe(404);
});

test("API каталога: контракт и публичный кеш", async ({ request }) => {
  const res = await request.get("/api/v1/matches?scope=upcoming");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("s-maxage=30");
  const body = await res.json();
  expect(body.data.items).toHaveLength(5);
  expect(body.meta.source).toBe("demo");
  expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);

  const one = await request.get("/api/v1/matches/demo-002");
  expect((await one.json()).data.acceptance.reason).toBe("CUTOFF");

  const missing = await request.get("/api/v1/matches/nope");
  expect(missing.status()).toBe(404);
  expect((await missing.json()).error.code).toBe("NOT_FOUND");
});
