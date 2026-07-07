# Project Setup — Frontend v1

Stack: Next.js (App Router) · TypeScript · Tailwind · TanStack Query · shadcn/ui · next-intl (ar/RTL)

## 1. Create project

```bash
npx create-next-app@latest naql-web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd naql-web
```

## 2. Install dependencies

```bash
# Data / server state --done
npm i @tanstack/react-query @tanstack/react-query-devtools axios

# Forms + validation --done
npm i react-hook-form zod @hookform/resolvers

# Client state (booking flow only) --done
npm i zustand

# i18n / RTL --done
npm i next-intl

# Utilities --done
npm i date-fns clsx tailwind-merge lucide-react sonner qrcode.react

# Tables (operator/admin — installed now, used in Phase D) --done
npm i @tanstack/react-table

# Dev --done
npm i -D msw prettier prettier-plugin-tailwindcss
```

## 3. shadcn/ui

```bash --done
npx shadcn@latest init
# style: default · base color: neutral · css vars: yes --done

npx shadcn@latest add button input select calendar popover dialog card badge skeleton separator sheet
```

## 4. Prettier --done

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

## 5. Env validation --done

`src/config/env.ts`:

```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3000/api/v1"),
  NEXT_PUBLIC_USE_MOCKS: z.enum(["true", "false"]).default("true"),
});

export const env = schema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS,
});
```

`.env.local`: ---done

```
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_USE_MOCKS=true
```

## 6. Folder structure (create empty dirs now)

```bash
mkdir -p src/{features,components/shared,lib,providers,config,types,mocks}
mkdir -p src/features/{search,booking,tickets,auth}/{components,hooks}
```

Target layout:

```
src/
├── app/
│   ├── (public)/            # home, search, trips
│   ├── (passenger)/         # tickets, profile   (Phase C)
│   ├── operator/            # (Phase D)
│   └── admin/               # (Phase D)
├── features/<name>/{components,hooks,api.ts,types.ts,schemas.ts}
├── components/{ui,shared}
├── lib/{api-client.ts, query-client.ts, query-keys.ts, utils.ts}
├── providers/
├── config/
├── types/
└── mocks/{data.ts, handlers.ts}
```

## 7. Core lib files --done

`src/lib/query-client.ts`:

```ts
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
}
```

`src/lib/api-client.ts`:

```ts
import axios from "axios";
import { env } from "@/config/env";

export const api = axios.create({ baseURL: env.NEXT_PUBLIC_API_URL });
// Auth interceptors added in Phase C.
```

`src/lib/query-keys.ts`:

```ts
export const queryKeys = {
  cities: { all: ["cities"] as const },
  trips: {
    search: (p: Record<string, string>) => ["trips", "search", p] as const,
    detail: (id: string) => ["trips", id] as const,
    seats: (id: string) => ["trips", id, "seats"] as const,
  },
  bookings: {
    mine: () => ["bookings", "mine"] as const,
    detail: (id: string) => ["bookings", id] as const,
  },
} as const;
```

`src/providers/query-provider.tsx`: --done

```tsx
"use client";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { makeQueryClient } from "@/lib/query-client";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
```

## 8. RTL + Arabic

- `next-intl` with `ar` as default locale, messages in `src/messages/ar.json`.
- Root layout: `<html lang="ar" dir="rtl">`.
- Font: `next/font` with an Arabic-friendly font (e.g. IBM Plex Sans Arabic or Cairo).
- Use logical Tailwind utilities (`ps-*`, `pe-*`, `start-*`, `end-*`) — never `pl-*`/`pr-*`.

## 9. Rules (enforced in review)

1. Components never call axios — data flows only through feature hooks.
2. Every API response parsed with zod in `features/*/api.ts`.
3. Query keys only from `lib/query-keys.ts`.
4. Server Components by default; `"use client"` only where interaction exists.
5. Mock data lives in `src/mocks/` only — never inline in components.
