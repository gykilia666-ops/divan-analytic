import { defineConfig } from "vitest/config";
import path from "node:path";

// Интеграционные тесты требуют локальный Supabase (Docker) и не входят в обычный `npm test`.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
