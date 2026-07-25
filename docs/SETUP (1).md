# Project Setup — naql-web

**Stack:** Next.js (App Router) · TypeScript · Tailwind · TanStack Query · shadcn/ui · next-intl (ar/RTL) · Supabase
**Repo model:** single repo. Frontend in `src/`, backend (migrations · RPCs · seed) in `supabase/`, backend tests in `tests/db/`.

> Sections 1–9 are already applied (Tasks 1–14 done). Section 10 covers the backend half.

## 1. Create project

```bash
npx create-next-app@latest naql-web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd naql-web
```

## 2. Dependencies

```bash
# Data / server state
npm i @tanstack/react-query @tanstack/react-query-devtools axios

# Forms + validation
npm i react-hook-form zod @hookform/resolvers

# Client state (booking flow only)
npm i zustand

# i18n / RTL
npm i next-intl

# Utilities
npm i date-fns clsx tailwind-merge lucide-react sonner qrcode.react

# Tables (operator/admin — Phase D)
npm i @tanstack/react-table

# Supabase client — used by the app AND by tests/db (one version, no drift)
npm i @supabase/supabase-js

# Dev
npm i -D msw prettier prettier-plugin-tailwindcss vitest supabase dotenv
```

`axios` stays while MSW is active — it talks to relative `/api/*` paths the worker intercepts. It is removed feature-by-feature during Phase E.

## 3. shadcn/ui

```bash
npx shadcn@latest init
# style: default · base color: neutral · css vars: yes

npx shadcn@latest add button input select calendar popover dialog card badge \
  skeleton separator sheet radio-group checkbox
```

`<Toaster />` (sonner) is mounted once in the root layout.

## 4. Prettier

`.prettierrc`:
```json
{ "semi": true, "singleQuote": false, "plugins": ["prettier-plugin-tailwindcss"] }
```

## 5. Environment files

Three files, three different jobs. Confusing them is the most likely way to lose data.

### `.env.local` — the Next.js app (not committed)
```
NEXT_PUBLIC_USE_MOCKS=true
NEXT_PUBLIC_SUPABASE_URL=https://<dev-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
```
The publishable/anon key ships to the browser by design — protection is RLS, not key secrecy.
**The service role key never appears here.**

### `.env.test` — backend tests (not committed)
```
SUPABASE_URL=https://<dev-ref>.supabase.co
SUPABASE_ANON_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=<service_role>
```
Points at the DEV project. `tests/db/helpers.ts` reads these with **no fallbacks** — a missing
variable throws a named error instead of silently connecting somewhere wrong.

### `.env.example` — committed
Same keys as `.env.test` with empty values, plus a comment that service_role is DEV-only.

Verify both are ignored:
```bash
git check-ignore .env.local .env.test
```

### `src/config/env.ts`
```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_USE_MOCKS: z.enum(["true", "false"]).default("true"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export const env = schema.parse({
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});

export const useMocks = env.NEXT_PUBLIC_USE_MOCKS === "true";
```

There is no `NEXT_PUBLIC_API_URL`. `api-client.ts` uses a relative `baseURL: "/api"`.

## 6. Folder structure

```
naql-web/
├── src/
│   ├── app/
│   │   ├── (public)/            # home, search, trips/[id]
│   │   ├── booking/             # checkout, confirmation
│   │   ├── (passenger)/         # tickets, tickets/lookup   (Task E4)
│   │   ├── operator/            # (Phase D)
│   │   └── admin/               # (Phase D)
│   ├── features/<name>/{components,hooks,api.ts,schemas.ts}
│   ├── components/{ui,shared}
│   ├── lib/{api-client.ts, api-error.ts, envelope.ts, supabase.ts, rpc.ts,
│   │        query-client.ts, query-keys.ts, utils.ts}
│   ├── providers/
│   ├── config/
│   ├── types/                   # domain.ts + database.ts (generated, committed)
│   ├── messages/                # ar.json
│   └── mocks/{data.ts, handlers.ts, browser.ts, init.ts}
├── supabase/{migrations,seed.sql,config.toml}
├── tests/db/                    # vitest against the hosted DEV project
├── tools/{qa,load}/
├── docs/
└── vitest.db.config.ts
```

`supabase.ts` and `rpc.ts` arrive in Task E1 (after backend M2) — not before.

## 7. Core lib files

### `src/lib/api-error.ts`
```ts
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

### `src/lib/envelope.ts` — the shared seam
```ts
import { z } from "zod";
import { ApiError } from "./api-error";

const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
]);

/** Unwraps the BACKEND_V1 §0 envelope. Shared by the MSW path and the Supabase path. */
export function unwrap<T>(raw: unknown, schema: z.ZodType<T>): T {
  const parsed = envelopeSchema.parse(raw);
  if (!parsed.ok) {
    throw new ApiError(parsed.error.code, parsed.error.message, parsed.error.details);
  }
  return schema.parse(parsed.data);
}
```

This is why Phase E is cheap. Every `api.ts` function changes exactly one line:

```ts
// MSW era
const { data } = await api.post(`/trips/${tripId}/seats/lock`, { seats });
return unwrap(data, lockResponseSchema);

// Supabase era
const { data } = await supabase.rpc("lock_seats", { p_trip_id: tripId, p_seats: seats });
return unwrap(data, lockResponseSchema);
```

Components, hooks, zod schemas, and every `ApiError.code` handler are untouched.

### `src/lib/rpc.ts` (Task E1 — thin, reuses `unwrap`)
```ts
import { z } from "zod";
import { supabase } from "./supabase";
import { unwrap } from "./envelope";
import { ApiError } from "./api-error";

export async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError("NETWORK_ERROR", error.message);
  return unwrap(data, schema);
}
```

Unchanged from Task 1: `query-client.ts`, `api-client.ts`, `query-keys.ts`, `providers/query-provider.tsx`.

## 8. RTL + Arabic

- `next-intl`, `ar` default locale, messages in `src/messages/ar.json`.
- Root layout: `<html lang="ar" dir="rtl">`.
- Font: `next/font` with IBM Plex Sans Arabic.
- Logical Tailwind utilities only — never `pl-*`/`pr-*` outside `src/components/ui`.

## 9. Rules (enforced in review)

1. Components never call axios or supabase — data flows through feature hooks → `features/*/api.ts`.
2. Every response goes through `unwrap()` in `features/*/api.ts`. No raw `.parse(response.data)`.
3. Error handling keys on `ApiError.code` only — never message text, **never HTTP status**. Domain errors are envelopes at HTTP 200 in both eras.
4. Query keys only from `lib/query-keys.ts`.
5. Server Components by default; `"use client"` only where interaction exists.
6. Mock data lives in `src/mocks/` only.
7. `src/types/database.ts` never leaks into components.
8. Booking flow client state lives in one zustand store: `src/features/booking/store.ts`.

## 10. Backend half of the repo

**This machine has no working Docker.** The backend runs against a hosted DEV Supabase project.

```bash
npm run db:whoami   # projects list + the currently linked ref — run before every reset
npm run db:reset    # supabase db reset --linked  → wipes DEV, replays ALL migrations + seed
npm run db:test     # vitest run -c vitest.db.config.ts   (reads .env.test)
npm run db:types    # supabase gen types typescript --linked > src/types/database.ts
```

### One-time setup

```bash
npx supabase login
npx supabase link --project-ref <dev-ref>
```

Then, in the dashboard for the DEV project — **`config.toml` does not apply to hosted projects**:

| Setting | Value |
|---|---|
| Authentication → Anonymous sign-ins | **ON** |
| Authentication → Email → Allow new users to sign up | **OFF** |
| Authentication → Email → Confirm email | **OFF** |

Skipping the first row makes every lock test fail with `UNAUTHORIZED`.

### Project roles

| Project | Role | `db reset` |
|---|---|---|
| `naql-dev` (current) | development + frontend integration from E2 | yes, routinely |
| CI runner | full local stack, concurrency merge gates | yes, every run |
| `naql-prod` | created before launch | **never** — `migration up` only |

### Rules

- Every schema change is a migration: `supabase migration new <name>`. Never edit an applied one.
- **Never write SQL in the dashboard.** A change that isn't a migration file does not exist.
- After any schema change run `db:types` and commit — the compiler then finds every stale consumer.
- Concurrency suites (B3/B4) are authoritative **in CI**, which runs a real local stack. A green run
  against hosted DEV is supporting evidence, not the gate.
- Conventions and RPC rules: backend section of `CLAUDE.md` + `docs/BACKEND_V1.md`.

## 11. Domain enums

```ts
export type Gender = "male" | "female"; // on passengers + locked/booked seats
```
