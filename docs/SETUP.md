# Project Setup — Frontend v1

Stack: Next.js (App Router) · TypeScript · Tailwind · TanStack Query · shadcn/ui · next-intl (ar/RTL) · **Supabase (Phase E backend)**

> Sections 1–7 already executed (Tasks 1–9 done). Section 5 and 10 updated for Supabase — apply the deltas when starting Phase E.

## 1. Create project

```bash
npx create-next-app@latest naql-web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd naql-web
```

## 2. Install dependencies

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

# Tables (operator/admin — installed now, used in Phase D)
npm i @tanstack/react-table

# Backend client (Phase E — install when starting Task E1)
npm i @supabase/supabase-js

# Dev
npm i -D msw prettier prettier-plugin-tailwindcss
```

## 3. shadcn/ui

```bash
npx shadcn@latest init
# style: default · base color: neutral · css vars: yes

npx shadcn@latest add button input select calendar popover dialog card badge skeleton separator sheet radio-group
```

## 4. Prettier

`.prettierrc`:
```json
{ "semi": true, "singleQuote": false, "plugins": ["prettier-plugin-tailwindcss"] }
```

## 5. Env validation (Supabase-aware)

`src/config/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_USE_MOCKS: z.enum(["true", "false"]).default("true"),
  // Phase E:
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

export const env = schema.parse({
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
```

`.env.local`:
```
NEXT_PUBLIC_USE_MOCKS=true
# Phase E:
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Note: `NEXT_PUBLIC_API_URL`/axios remain only while MSW is active (MSW intercepts HTTP). They are removed feature-by-feature during Phase E as `api.ts` internals switch to supabase-js.

## 6. Folder structure

```
src/
├── app/
│   ├── (public)/            # home, search, trips
│   ├── (passenger)/         # tickets, tickets/lookup   (Task E4 — no auth)
│   ├── operator/            # (Phase D)
│   └── admin/               # (Phase D)
├── features/<name>/{components,hooks,api.ts,types.ts,schemas.ts}
├── components/{ui,shared}
├── lib/{api-client.ts, supabase.ts, rpc.ts, query-client.ts, query-keys.ts, utils.ts}
├── providers/
├── config/
├── types/                   # domain.ts + database.ts (supabase gen types, synced from backend repo)
└── mocks/{data.ts, handlers.ts}
```

## 7. Core lib files

(unchanged: `query-client.ts`, `api-client.ts`, `query-keys.ts`, `query-provider.tsx` — see repo)

Phase E additions:

`src/lib/supabase.ts`:
```ts
import { createClient } from "@supabase/supabase-js";
import { env } from "@/config/env";
import type { Database } from "@/types/database";

export const supabase = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
```

`src/lib/rpc.ts`:
```ts
import { z } from "zod";
import { supabase } from "./supabase";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const envelope = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    }),
  }),
]);

export async function callRpc<T>(
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new ApiError("NETWORK_ERROR", error.message);
  const parsed = envelope.parse(data);
  if (!parsed.ok) {
    const e = parsed.error;
    throw new ApiError(e.code, e.message, e.details);
  }
  return schema.parse(parsed.data);
}
```

## 8. RTL + Arabic

- `next-intl` with `ar` as default locale, messages in `src/messages/ar.json`.
- Root layout: `<html lang="ar" dir="rtl">`.
- Font: `next/font` with an Arabic-friendly font (IBM Plex Sans Arabic).
- Use logical Tailwind utilities (`ps-*`, `pe-*`, `start-*`, `end-*`) — never `pl-*`/`pr-*`.

## 9. Rules (enforced in review)

1. Components never call axios **or supabase** — data flows only through feature hooks → `features/*/api.ts`.
2. Every API/RPC response parsed with zod in `features/*/api.ts` (RPCs via `callRpc`).
3. Query keys only from `lib/query-keys.ts`.
4. Server Components by default; `"use client"` only where interaction exists.
5. Mock data lives in `src/mocks/` only — never inline in components.
6. Supabase types (`types/database.ts`) never leak into components — domain types come from `features/*/schemas.ts`.
7. Error handling keyed on `ApiError.code` only, never message text.

## 10. Domain enums

```ts
export type Gender = "male" | "female"; // on passengers + locked/booked seats
```
