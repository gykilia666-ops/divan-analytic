import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Автоматическая проверка доступности (WCAG 2.1 A/AA) ключевых экранов в demo, desktop и 360px.
// Автопроверка находит не все проблемы: клавиатура и фокус дополнительно проверены вручную.

const PAGES = [
  "/",
  "/matches",
  "/matches/demo-001",
  "/leaderboard",
  "/rules",
  "/privacy",
  "/terms",
  "/consent",
  "/login",
];

for (const path of PAGES) {
  test(`axe без нарушений: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const summary = result.violations.map(
      (v) => `${v.id} (${v.impact ?? "?"}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    );
    expect(summary).toEqual([]);
  });
}

test("клавиатура: первым Tab фокусируется ссылка «Перейти к содержимому»", async ({ page }) => {
  await page.goto("/matches");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
});
