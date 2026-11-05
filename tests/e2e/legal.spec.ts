import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Юридические страницы и подвал (ADR-065…068). Режим demo: аккаунтов нет, вход и API согласий закрыты.

const DOCUMENTS = [
  { path: "/terms", heading: "Пользовательское соглашение", must: "18 лет" },
  { path: "/privacy", heading: "Политика обработки персональных данных", must: "Роскомнадзор" },
  { path: "/consent", heading: "Согласие на обработку персональных данных", must: "Supabase" },
];

for (const doc of DOCUMENTS) {
  test(`документ открывается: ${doc.path}`, async ({ page }) => {
    const res = await page.goto(doc.path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: doc.heading })).toBeVisible();
    await expect(page.getByText(/Редакция от \d{1,2} \S+ \d{4} года/)).toBeVisible();
    await expect(page.locator("article")).toContainText(doc.must);
    // Данные оператора показываются всегда: заполненные или явное «не указано» (в demo).
    await expect(page.getByTestId("operator-name").first()).not.toBeEmpty();
  });
}

test("подвал: ссылки на все документы, отметка 18+", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Юридические документы" });
  await expect(nav.getByRole("link")).toHaveCount(3);
  for (const name of [
    "Пользовательское соглашение",
    "Политика обработки персональных данных",
    "Согласие на обработку персональных данных",
  ]) {
    await expect(nav.getByRole("link", { name })).toBeVisible();
  }
  await expect(page.getByTestId("age-mark")).toHaveText("18+");
});

test("подвал: ссылка на источник данных только при football-data", async ({ page }) => {
  // В e2e поставщик fixtures: чужое имя в подвале не показываем.
  await page.goto("/");
  await expect(page.getByTestId("data-attribution")).toHaveCount(0);
});

test("переход из подвала на документ", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Юридические документы" })
    .getByRole("link", { name: "Пользовательское соглашение" })
    .click();
  await expect(page).toHaveURL(/\/terms$/);
});

test("правила: 18+ и ссылка на Соглашение", async ({ page }) => {
  await page.goto("/rules");
  await expect(page.getByText("Сервис только для лиц старше 18 лет")).toBeVisible();
  await expect(page.getByRole("link", { name: "Пользовательского соглашения" })).toBeVisible();
});

for (const doc of DOCUMENTS) {
  test(`axe без нарушений: ${doc.path}`, async ({ page }) => {
    await page.goto(doc.path);
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
