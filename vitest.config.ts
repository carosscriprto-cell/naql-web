import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Frontend unit tests. Pure functions only — no network, no env, no Supabase.
// The DB suite is a separate config (vitest.db.config.ts, `npm run db:test`):
// it needs .env.test credentials and must not run in parallel with itself.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
