import { expect, test } from "@playwright/test";

// CSP с nonce (CLAUDE.md §13.4): заголовок есть, нарушений нет, страницы гидрируются.

const PAGES = ["/", "/matches", "/matches/demo-001", "/leaderboard", "/rules", "/login"];

test("CSP с nonce и базовые заголовки безопасности", async ({ request }) => {
  const res = await request.get("/");
  const csp = res.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).not.toContain("'unsafe-inline' 'strict-dynamic'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();

  const second = await request.get("/");
  expect(second.headers()["content-security-policy"]).not.toBe(csp);
});

for (const path of PAGES) {
  test(`без нарушений CSP: ${path}`, async ({ page }) => {
    const violations: string[] = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (/Content Security Policy|Refused to (execute|load|apply)/i.test(text))
        violations.push(text);
    });
    page.on("pageerror", (err) => violations.push(err.message));
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Next.js ставит nonce своим скриптам — иначе приложение не гидрировалось бы.
    const nonced = await page.locator("script[nonce]").count();
    expect(nonced).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
}
