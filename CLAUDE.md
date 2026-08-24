# CLAUDE.md

**Setup and wiring instructions for this repo live in [`AGENTS.md`](./AGENTS.md) — read that first.**
It covers provisioning the database, every environment variable, going live, wiring calendar / SMS /
payments, and the specific gotchas that break a setup. This file just orients you fast.

## What this is
Slotter — a multi-tenant booking system. **Next.js 15 + Supabase**; everything else (email,
calendar, SMS, payments) is optional and gated by `APP_MODE`:
- `APP_MODE=demo` → fully working with **zero external accounts**. Start here.
- `APP_MODE=prod` → real email/calendar/SMS/payments, turned on one integration at a time.

Two editions via `SLOTTER_EDITION`: `agency` (white-label hub) or `market` (self-serve SaaS).

## Fastest path
1. `cp .env.example .env.local`, then set `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `BH_API_KEY`, `APP_SECRET` (`openssl rand -hex 32` for the last two). Keep `APP_MODE=demo`.
2. Run `db/schema.sql` in Supabase; make `bh_secrets.api_key` equal `BH_API_KEY`.
3. `npm install && npm run setup:check` → fix every ✗.
4. `npm run dev` → `/admin` to create a business, `/b/<slug>` to book, `/dashboard` to manage.
5. Deploy, set the same env in the host, `npm run verify -- <url>`, then follow **AGENTS.md §4** to
   go to prod and wire integrations.

## Rules
- Never commit secrets. `.env.local` is git-ignored; keep real keys in the host's env store.
- After any env change on a deployed host, **redeploy** — env is read at build/boot.
- Before editing notification/calendar code, read **AGENTS.md §3** so you don't reintroduce the
  duplicate-calendar-event or `MAIL_FROM` bugs.
- Verify with `npm run setup:check` and `npm run verify` — don't hand-guess env correctness.
