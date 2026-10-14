import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["tests/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://fixitbro@localhost:5433/fixitbro_test",
      JWT_SECRET: "test-secret-0123456789abcdef",
      AUTH_RATE_MAX: "1000",
      API_RATE_MAX: "100000",
      PENDING_TTL_MINUTES: "1440",
    },
  },
});
