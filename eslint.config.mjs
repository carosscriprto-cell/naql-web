import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// A Supabase client is a trust boundary, not a utility: which identity a query
// runs as (session / cookie session / no session) decides what RLS lets it see.
// Constructing one ad hoc silently picks that boundary at a random import site.
const SUPABASE_CLIENT_MESSAGE =
  "Import a client from src/lib/supabase/{browser,server,public} — they are named by trust " +
  "boundary. Never construct a Supabase client elsewhere.";

const SUPABASE_PACKAGES = ["@supabase/supabase-js", "@supabase/ssr"];

// `allowTypeImports`: a type-only import is erased at compile time and cannot
// construct a client — lib/rpc.ts needs `type SupabaseClient` for its signatures.
const restrictSupabaseImports = {
  files: ["**/*.{ts,tsx,mts,cts}"],
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        paths: SUPABASE_PACKAGES.map((name) => ({
          name,
          message: SUPABASE_CLIENT_MESSAGE,
          allowTypeImports: true,
        })),
        patterns: [
          {
            group: SUPABASE_PACKAGES.map((name) => `${name}/*`),
            message: SUPABASE_CLIENT_MESSAGE,
            allowTypeImports: true,
          },
        ],
      },
    ],
  },
};

// The only places allowed to build a client: the three trust-boundary modules,
// the feature api layer, and the off-app harnesses — tests/db/** and the QA
// scripts in tools/**, both of which run under node against .env.test and are
// never bundled, so the service role is legitimate there and only there.
const supabaseClientAllowlist = {
  files: [
    "src/lib/supabase/**",
    "src/features/*/api.ts",
    "tests/db/**",
    "tools/**",
  ],
  rules: {
    "@typescript-eslint/no-restricted-imports": "off",
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  restrictSupabaseImports,
  supabaseClientAllowlist,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
