This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.


| Setting | Value | Why |
|---|---|---|
| Email provider | **Enabled** | operators/admins sign in with email+password (OPR-0) |
| Allow new users to sign up | **Disabled** | accounts are admin-created only |
| Confirm email | **Disabled** | seeded accounts have no inbox |
| Anonymous sign-ins | **Enabled** | passenger identity in v1 |

Disabling the Email *provider* (instead of just signup) breaks operator login with
"Email logins are disabled" — these are two separate toggles.

## QA scripts (hosted DEV)

Backend seat-locking demos that MSW faked deterministically are reproduced on the
DEV project with service-role scripts in `tools/qa/`. They read
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env.test`.

- **Pre-lock seat 13** (QA-B-16 — lock-conflict UX):
  ```bash
  npx tsx tools/qa/prelock-seat-13.ts [tripId] [male|female]
  ```
  Holds seat `13` on a seeded trip (default: الأمانة دمشق→حلب, `n=1`) for a year so
  `lock_seats` returns `SEAT_ALREADY_LOCKED` for it. Idempotent — re-running
  replaces the existing seat-13 lock. Undo by releasing via the app or deleting
  the lock row in the dashboard.

- **Shorten a lock** (LOCK_EXPIRED UX — no 10-minute wait):
  ```bash
  npx tsx tools/qa/shorten-lock.ts <lockId>
  npx tsx tools/qa/shorten-lock.ts --trip <tripId>          # newest lock on that trip
  npx tsx tools/qa/shorten-lock.ts --trip <tripId> --in 30  # expire in 30s instead
  ```
  Moves `expires_at` into the past (or `--in N` seconds ahead) and **keeps the lock
  row**, so `create_booking` still finds it and rejects it with `LOCK_EXPIRED` —
  the same state a real timeout produces. `get_seat_map` frees the seats on the
  next poll. Hold seats in the browser first, then run it with `--trip`.

## Pre-launch checklist (PROD only)

PROD receives `supabase migration up` and is **never** reset, so `supabase/seed.sql`
never runs there. Everything the seed does for DEV/CI must be done by hand once:

- [ ] **Create the QR HMAC secret in Vault.** `create_booking` signs every
      `qrPayload` with it and raises a loud error if it is missing — nothing can be
      booked until this exists. In the SQL editor of the PROD project (this is the
      one and only exception to "never write SQL in the dashboard" — a secret must
      not be committed to a migration):
      ```sql
      select vault.create_secret(
        '<a fresh 32+ byte random string>',
        'qr_hmac_secret',
        'QR ticket HMAC key (production)'
      );
      ```
      Verify: `select name from vault.decrypted_secrets where name = 'qr_hmac_secret';`
      The name must be exactly `qr_hmac_secret`. **Do not reuse the DEV/CI value**
      seeded by `supabase/seed.sql` — it is public in this repo, and anyone holding
      it can forge a check-in QR.
- [ ] Configure the dashboard auth settings (see the table above — they are not in
      `config.toml`) and register the custom access token hook.
- [ ] Rotate every seeded credential; the `Password123!` accounts are DEV-only.

## Anonymous session pool (DB tests)

`tests/db/` reuses anonymous identities instead of minting one per test, because
`signInAnonymously()` is rate-limited on the hosted DEV project (~30/hour/IP).
`pooledAnonClient(index)` caches each slot's session under
`node_modules/.cache/naql-anon-sessions.json` (gitignored) and restores it via the
refresh token — so only the **first** run mints users; later runs make zero
anonymous sign-ins for pooled slots.

- **`db:reset` invalidates the pool automatically** — it wipes `auth.users`, so the
  cached refresh tokens stop working and the pool re-mints its slots on the next run.
  No manual step needed. (`clearAnonSessionCache()` exists as a manual escape hatch.)
- Tests that assert a *brand-new* sign-in (smoke's "anonymous passenger can open a
  session", claims' anonymous case) keep the real `anonClient()` / `signInAnonymously()`.
