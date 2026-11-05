import { expect, test } from "@playwright/test";

// Фон с параллаксом: изображение загружается, слой смещается пропорционально прокрутке,
// при prefers-reduced-motion остается на месте и не мешает взаимодействию.

async function shift(page: import("@playwright/test").Page): Promise<number> {
  return page
    .getByTestId("parallax-layer")
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42);
}

test("фоновое изображение загружено и скрыто от скринридеров", async ({ page }) => {
  await page.goto("/matches?scope=all");
  const img = page.getByTestId("parallax-layer").locator("img");
  await expect(img).toHaveAttribute("alt", "");
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
  await expect(page.locator('[aria-hidden="true"]').filter({ has: img })).toHaveCount(1);
});

test("фон смещается при прокрутке и возвращается наверху", async ({ page }) => {
  await page.goto("/matches?scope=all");
  expect(await shift(page)).toBeCloseTo(0, 0);
  // Прокрутка повторяется внутри ожидания: под нагрузкой страница может еще не вырасти или не
  // гидратироваться, и единичная прокрутка тогда не сдвигает слой.
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      return shift(page);
    })
    .toBeLessThan(-10);
  await expect
    .poll(async () => {
      await page.evaluate(() => window.scrollTo(0, 0));
      return shift(page);
    })
    .toBeGreaterThan(-1);
});

test("при prefers-reduced-motion фон неподвижен", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/matches?scope=all");
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  expect(await shift(page)).toBeCloseTo(0, 0);
  await context.close();
});

test("фон не перехватывает клики", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Посмотреть матчи" }).click();
  await expect(page).toHaveURL(/\/matches/);
});
