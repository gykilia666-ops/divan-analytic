import { expect, test } from "@playwright/test";

// Сквозной вход через настоящий GitHub проверяется вручную (docs/requirements.md §18.3).
// Здесь — поведение режима demo и отсутствие обходов авторизации.

test("страница входа в demo сообщает, что вход недоступен", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-unavailable")).toContainText("недоступен в демо-режиме");
  await expect(page.getByRole("button", { name: "Войти через GitHub" })).toHaveCount(0);
});

test("защищенный кошелек без сессии перенаправляет на вход с возвратом", async ({ page }) => {
  await page.goto("/my/wallet");
  await expect(page).toHaveURL(/\/login\?next=%2Fmy%2Fwallet$/);
});

test("API /me без сессии отвечает 401 по контракту", async ({ request }) => {
  const res = await request.get("/api/v1/me");
  expect(res.status()).toBe(401);
  expect(res.headers()["cache-control"]).toContain("no-store");
  const body = await res.json();
  expect(body.error.code).toBe("UNAUTHENTICATED");
  expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(body)).not.toMatch(/stack|select |supabase/i);
});

test("команды входа и выхода в demo недоступны", async ({ request }) => {
  const login = await request.post("/auth/login", { form: { next: "/my/wallet" } });
  expect(login.status()).toBe(503);
  const signout = await request.post("/auth/signout");
  expect(signout.status()).toBe(503);
});

test("callback в demo не существует", async ({ request }) => {
  const res = await request.get("/auth/callback?code=abc", { maxRedirects: 0 });
  expect(res.status()).toBe(404);
});

test("внешний адрес в next не уводит со страницы входа", async ({ page }) => {
  await page.goto("/login?next=//evil.com");
  // Параметр остается в строке запроса, но мы не покидаем свой хост.
  expect(new URL(page.url()).hostname).toBe("localhost");
  await expect(page.getByTestId("login-unavailable")).toBeVisible();
});
