import { defineConfig } from "vitest/config";

// Unit tests only. End-to-end tests live in tests/e2e and run under Playwright
// (`npm run test:e2e`), which owns its own runner.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
});
