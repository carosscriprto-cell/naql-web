import { config } from "dotenv";
import { defineConfig } from "vitest/config";

// Load DB test credentials from .env.test (not .env / .env.local). Runs in the
// config's main process before workers spawn, so process.env propagates to them.
config({ path: process.env.DOTENV_CONFIG_PATH ?? ".env.test" });

export default defineConfig({
  test: {
    // Test FILES run one at a time. Concurrency tests (B3/B4) drive their own
    // real parallelism internally via Promise.all — they must not race other
    // files against the same Postgres.
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
    // Backend/DB tests only — kept separate from any frontend test config.
    include: ["tests/db/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
