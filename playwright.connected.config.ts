import { defineConfig, devices } from "@playwright/test";
import { E2E_ORIGIN, E2E_PORT, serverEnv } from "./tests/e2e-connected/env";

// Полный путь пользователя в режиме connected на ЛОКАЛЬНОМ Supabase (docs/testing-strategy.md, п. 1).
// Нужны: npm run db:start, npm run build. Запуск: npx playwright test -c playwright.connected.config.ts
// Тесты меняют общую БД (пользователи, прогнозы), поэтому идут последовательно.
export default defineConfig({
  testDir: "tests/e2e-connected",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: E2E_ORIGIN, trace: "on-first-retry" },
  projects: [{ name: "connected", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run start -- -p ${E2E_PORT}`,
    url: `${E2E_ORIGIN}/api/health`,
    reuseExistingServer: false,
    env: serverEnv(),
    timeout: 90_000,
    // Логи сервера приложения — в вывод теста: иначе причина его падения не видна.
    stdout: "pipe",
    stderr: "pipe",
  },
});
