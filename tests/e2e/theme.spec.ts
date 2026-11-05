import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Тема «День / Ночь»: переключение, сохранение после перезагрузки, доступность в обеих темах.

const bodyBg = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("без выбора — системная тема; переключатель меняет тему и запоминает ее", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAccessibleName("Включить тему «Ночь»");
  const lightBg = await bodyBg(page);

  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAccessibleName("Включить тему «День»");
  expect(await bodyBg(page)).not.toBe(lightBg);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName("Включить тему «День»");

  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bodyBg(page)).toBe(lightBg);
});

test("явный выбор «День» важнее системной ночной темы", async ({ page, context }) => {
  await context.addCookies([{ name: "theme", value: "light", url: "http://localhost:3100" }]);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByTestId("theme-toggle")).toHaveAccessibleName("Включить тему «Ночь»");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe без нарушений в теме ${theme}`, async ({ page, context }) => {
    await context.addCookies([{ name: "theme", value: theme, url: "http://localhost:3100" }]);
    await page.goto("/matches");
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });
}
