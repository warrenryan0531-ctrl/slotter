# AGENTS.md — Setting up Slotter with an AI agent

**You are an AI coding agent and someone just handed you this repository. Read this file top to
bottom before doing anything. It tells you exactly how to wire Slotter up — what to provision, in
what order, the env vars that matter, and the specific traps that waste an hour if you hit them
blind.** Follow it and a working booking system is ~15 minutes of real work away.

This guide is provider-agnostic and uses placeholders. Never invent secrets; ask the human for
account access or have them paste keys. Never commit real secrets (`.env.local` is git-ignored).

---

## First: if a human is here, be their setup wizard

If a person is in the loop (not a headless CI/cron run), **don't silently start installing things.**
Open warmly, orient them, and interview them so you build ONLY what they want. Open with something like:

> "Hi! I'm going to set up **Slotter** for you — your own booking system that you'll completely own,
> with no per-seat fees. It works out of the box with no paid services, and we only switch on extras
> if you actually want them. First, a few quick questions so I set up exactly what fits you."

Then ask (adapt to anything they've already told you — never re-ask what you know):

1. **Who is this for?** Just your own single business, or are you offering booking to *many* businesses
   (an agency/host)? → sets `SLOTTER_EDITION` (`agency` vs `market`; see `docs/EDITIONS.md`).
2. **What will people book?** Appointments, phone calls, or group classes/events? → which services to create.
3. **Take a deposit or payment at booking?** → whether to wire Stripe (into *their own* Stripe account).
4. **Text-message reminders/confirmations?** → whether to wire Twilio (heads-up: US texting also needs
   A2P 10DLC registration, which takes a few days — the wiring itself is quick). **If they answered "many
   businesses" in Q1, also ask: should each business text from its OWN number, or is one shared number
   fine?** This is a real branding/compliance decision — explain it and see [`docs/SMS.md`](./docs/SMS.md).
5. **Sync with a calendar they already use** (Google or Outlook)? → whether to set up calendar OAuth.
6. **Where should it live?** Do they have a Vercel account (or other host) and a domain?

Then reflect a short plan back ("Here's what I'll set up: … — sound good?") and work through only the
relevant steps below. **Every integration is optional — skip anything they didn't ask for.** Keep them
updated in plain, non-technical language, and always pause before anything that spends money or needs
their login (buying a phone number, creating accounts, granting calendar access). Do as much of the
rest for them as your tools allow. If you're running unattended (no human), skip the interview and use
the defaults in the steps below.

---

## 0. What you are wiring up (read this first)

Slotter is a **multi-tenant booking system**: one deployment serves many businesses, each with its
own booking page (`/b/<slug>`), staff, services, availability and branding. Stack:

- **Next.js 15** (App Router, TypeScript) — the app.
- **Supabase (Postgres)** — the only required datastore. Security is enforced *in the database*
  (Row-Level Security + guarded `SECURITY DEFINER` functions), gated by a shared app key.
- **Everything else is optional and pluggable.** The code uses a ports-and-adapters design with a
  single switch, `APP_MODE`:
  - `APP_MODE=demo` → **fully functional with zero external accounts.** Email lands in an in-app
    outbox, payments use a built-in test checkout, calendar/SMS are simulated. **Always start here.**
  - `APP_MODE=prod` → real email (Resend), real deposits (each tenant's own Stripe), real calendar
    sync (Google/Microsoft), real SMS (Twilio). You turn these on **one at a time**; each is
    independent and off until you set its keys.

So the winning strategy is: **get it running in demo mode first (proves the DB + build are correct),
then flip to prod and wire integrations incrementally, verifying after each.**

**Two editions**, chosen by `SLOTTER_EDITION` (see `docs/EDITIONS.md`):
- `agency` (default) — white-label hub; an admin provisions businesses; no public signup.
- `market` — self-serve SaaS; public signup + onboarding wizard + marketing landing + owner billing.

---

## 1. Prerequisites

Ask the human which of these they have; you only need the first two to get a working demo.

| Need | For | Required? |
|------|-----|-----------|
| A **Supabase** project | database | **Yes** |
| A **host** (Vercel recommended; any Node host works) | serving the app | Yes to go live (local dev needs nothing) |
| A **Resend** account + a domain you can verify | real email in prod | Only for `APP_MODE=prod` |
| A **Google Cloud** and/or **Microsoft Entra** project | two-way calendar sync | Optional |
| A **Twilio** account | SMS confirmations/reminders | Optional |
| **Stripe** (each tenant's own) | paid deposits | Optional, per tenant |

Node 18+ and `npm`. `openssl` for generating secrets (or any 32-byte random hex).

---

## 2. Step-by-step

### Step 1 — Database (Supabase)

1. Create (or have the human create) a Supabase project. Grab **Project URL** and **anon public
   key** from *Settings → API*.
2. Open the SQL editor and run **`db/schema.sql`** in full. This creates every table, the RLS
   policies, and the guarded RPCs. It is idempotent-friendly for a fresh project.
3. **Set the app key.** `db/schema.sql` seeds a `bh_secrets` row with a placeholder api_key. It
   **must equal** the `BH_API_KEY` you put in the env (next step) or *every* database call is
   rejected. Either edit the `REPLACE_WITH_BH_API_KEY` value in the SQL before running, or
   `UPDATE bh_secrets SET api_key = '<your BH_API_KEY>';` after.
4. *(Optional)* Run **`db/seed.sql`** for demo businesses to click around. **Do not run seed on a
   real production database** — it inserts fictional tenants you'll have to delete later.
5. **Upgrading an existing install** instead of a fresh one? Apply only the new files in
   `db/migrations/` (they are additive and safe); `db/schema.sql` already folds them in for fresh
   installs. Check `docs/` for any migration notes.

If you have MCP access to Supabase, you can do all of this through the Supabase tools instead of the
dashboard.

### Step 2 — Environment

1. `cp .env.example .env.local` — **`.env.example` is the authoritative, commented list of every
   variable.** Read it; it explains each one.
2. Generate the two secrets: `openssl rand -hex 32` for **`BH_API_KEY`** and again for
   **`APP_SECRET`**. `APP_SECRET` encrypts stored OAuth tokens (AES-256-GCM) and signs login
   sessions — changing it later invalidates every stored calendar connection, so pick it once.
3. Fill `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BH_API_KEY`, `APP_SECRET`, `NEXT_PUBLIC_BASE_URL`,
   and `ADMIN_EMAILS`. Leave `APP_MODE=demo` for now.
4. **Validate before going further:** `npm install` then `npm run setup:check`. It reads
   `.env.local`, tells you what's missing or malformed, and catches the common mistakes (see
   Gotchas). Fix every ✗.

### Step 3 — Run it (demo first)

- Local: `npm run dev` → open `http://localhost:3000`. Owner dashboard is at `/dashboard`
  (passwordless email-code login; in demo the code is shown to you). Admin console at `/admin`
  (must be signed in as an `ADMIN_EMAILS` address). A business's public page is `/b/<slug>`.
- Deploy (Vercel): `npx vercel deploy --prod` (or connect the Git repo). Set the **same env vars**
  in the host's dashboard. **Redeploy after any env change** — Next.js reads env at build/boot, so
  new values don't apply to an already-running deployment until you redeploy.
- Verify: `npm run verify -- <your-url>` (hits `/api/health`, reports `mode`/`edition`/`db`).

Once demo works end-to-end (create a business in `/admin`, book a slot on `/b/<slug>`), move to prod.

### Step 4 — Go live + wire integrations (each is optional and independent)

Set `APP_MODE=prod`, then turn on only what the human wants. Re-run `npm run setup:check` after each.

**Email (Resend) — required for prod.**
1. In Resend, add and verify the sending **domain** (DNS records). Create an **API key**.
2. Set `RESEND_API_KEY` and `MAIL_FROM`. **`MAIL_FROM` must be a BARE address** like
   `bookings@yourdomain.com` — see Gotchas; this is the #1 prod tripwire.

**Calendar sync — Google.** (Two-way: reads the owner's busy times so slots aren't double-booked,
and writes each booking onto their calendar. Works simulated in demo with no keys.)
1. Google Cloud Console → **enable the Google Calendar API** for the project.
2. Configure the **OAuth consent screen** (External is fine). Requesting the calendar scopes makes
   the app "unverified" until Google reviews it — that's OK for the owner's own use (see Gotchas).
3. Create an **OAuth client → Web application**. Add the **authorized redirect URI, exactly:**
   `<NEXT_PUBLIC_BASE_URL>/api/calendar/callback?provider=google` — **include the
   `?provider=google` query string.** Google accepts query components and the app sends this exact
   value; a mismatch is `redirect_uri_mismatch`.
4. Put the client id/secret in `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`. Redeploy.
5. The owner connects from **Dashboard → Availability → Connect Google**. On the consent screen they
   must **grant BOTH calendar scopes** ("Select all") — read *and* events — or busy-time blocking
   won't work. The app requests `access_type=offline` + `prompt=consent` so a **refresh token** is
   stored (long-lived sync). If you don't see a `refresh_token` persisted, the owner had a stale
   grant — have them remove the app at myaccount.google.com and reconnect.

**Calendar sync — Microsoft/Outlook.** Register an app in **Entra ID**. Redirect URI (exact):
`<NEXT_PUBLIC_BASE_URL>/api/calendar/callback?provider=microsoft`. Scopes:
`offline_access Calendars.ReadWrite User.Read`. Set `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET`,
and `MS_OAUTH_TENANT` (`common` for multi-tenant, or your tenant id).

**SMS (Twilio).** Set **all three** of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
(a Twilio number). Any missing → the deployment-wide sender is off. Demo texts land in `/demo/outbox`.

> **⚠️ Tell the admin this before they enable SMS on a MULTI-business hub — it's the #1 thing they need
> to decide.** Those env vars are **one shared number for the ENTIRE deployment**: every business on the
> hub texts from the *same* number, under the *same* Twilio account and A2P registration. That means
> shared branding, shared sender reputation (one bad client hurts all), a shared STOP/opt-out list, and
> — importantly for US texting — the *operator* is the registered A2P sender for everyone (the
> "reseller/ISV" pattern, which carriers scrutinize). Fine for a single business; think hard for an
> agency. **Slotter also supports a per-business own number:** put that tenant's Twilio creds in the
> `bh_tenant_sms` table (`active = true`) and its texts send from *its* number, with the shared number as
> fallback for everyone else — no code change, just data. Walk the admin through the choice and read them
> the tradeoffs. **Full explanation + setup SQL: [`docs/SMS.md`](./docs/SMS.md).**

**Per-business SMS numbers (AI: this is the "different number per business" wiring).** The app already
supports it — the sending number is resolved *per tenant at send time* by `TwilioSms.credsFor()` in
[`lib/services/index.ts`](./lib/services/index.ts): if the tenant has an active `bh_tenant_sms` row it
uses that business's own number; otherwise it falls back to the deployment-wide `TWILIO_*` env sender.
So you do **not** edit code to give a business its own number — you insert one row. For each business
that should text from its own purchased number:

1. In Twilio (ideally a **subaccount** per client, so billing/registration stay isolated), buy that
   client's number and register **their** business for A2P 10DLC (their brand + campaign).
2. Insert their creds on their tenant row (the `bh_tenant_sms` table ships in `db/schema.sql` and
   `db/migrations/007_tenant_sms.sql`; it's gated by the same app-key RLS as every other secret table):

   ```sql
   insert into bh_tenant_sms (tenant_id, twilio_account_sid, twilio_auth_token, twilio_from, active)
   values ('<TENANT_ID>', 'AC…', '<their auth token>', '+1<their number>', true)
   on conflict (tenant_id) do update
     set twilio_account_sid = excluded.twilio_account_sid,
         twilio_auth_token  = excluded.twilio_auth_token,
         twilio_from        = excluded.twilio_from,
         active             = true;
   ```

3. That's it — that tenant now sends from its own number; everyone else keeps the shared one (or no SMS
   if none is set). To move a client back to the shared number, set `active = false` on their row.

If the admin instead wants **every** business on its own number and no shared fallback at all, just leave
the `TWILIO_*` env vars unset and give each tenant a `bh_tenant_sms` row. Full walkthrough + gotchas
(A2P timing, subaccounts, toll-free) in [`docs/SMS.md`](./docs/SMS.md).

**Paid deposits (per-tenant Stripe).** Deposits are **not** an env var — each tenant stores their
**own** Stripe keys (in `bh_tenant_payments`) via the dashboard, so money lands in *their* account
and this app never touches card data. Each tenant must also create a Stripe **webhook** to
`<BASE>/api/webhooks/stripe`; missing it silently leaves paid bookings stuck "pending". See
`docs/PAYMENTS.md`.

**Owner billing (market edition only).** To charge business owners for the product, set
`SLOTTER_BILLING=stripe` plus your **platform** `STRIPE_PLATFORM_SECRET_KEY`, `STRIPE_PRICE_ID`, and
`STRIPE_BILLING_WEBHOOK_SECRET` (endpoint `<BASE>/api/billing/webhook`). Unset = everyone is on a
working free plan.

### Step 5 — Verify

- `npm run verify -- <your-url>` → expect `ok:true`, `db:up`, and the `mode`/`edition` you intend.
- Provision a business (`/admin`, or public signup on the market edition) and **make a real test
  booking** on its `/b/<slug>` page. Confirm the customer email arrives and (if calendar is wired)
  exactly **one** event appears on the owner's calendar.
- **Clean up** any test bookings/emails afterward.

---

## 3. GOTCHAS — read these, they are the whole point of this file

- **`MAIL_FROM` must be a BARE email** (`bookings@domain.com`), never `Name <bookings@domain.com>`.
  The mailer adds the display name itself; a pre-wrapped value yields an invalid `From`, Resend
  rejects it, and the booking POST returns **HTTP 500**. `setup:check` flags this.
- **OAuth redirect URIs include the `?provider=…` query** and must match **character-for-character**
  what's registered (`…/api/calendar/callback?provider=google`). This is the most common calendar
  failure.
- **Grant both Google calendar scopes.** The consent screen lets the user tick only one; if they
  skip the read scope, write-back works but busy-time blocking doesn't. Tell them "Select all".
- **`BH_API_KEY` (env) must equal `bh_secrets.api_key` (DB).** If they drift, every request 401s /
  RLS-denies with no obvious cause. This is the #1 "nothing works after fresh install" bug.
- **Vercel + `NEXT_PUBLIC_*`:** these must be **non-sensitive** ("plain"/"config") so they inline at
  build time. Vercel *rejects* sensitive visibility for `NEXT_PUBLIC_*` on Production/Preview.
- **Vercel + Sensitive vars:** a Sensitive env var **cannot target the Development environment** —
  scope secrets to Production (and Preview) only, or the API call fails.
- **Redeploy after env changes.** An already-running deployment keeps its old env until you redeploy.
- **Preview deployments are auth-walled** (Vercel protection) — `/api/health` returns a 302 to SSO.
  Test the public production URL, or use a protection-bypass token; don't mistake the wall for a bug.
- **Calendar busy times are cached ~60s.** After you add/remove a busy event, slot availability can
  take up to a minute to reflect it. Not a bug — wait and re-check.
- **`.ics` invites can auto-add to the owner's calendar.** Slotter already suppresses the owner's
  `.ics` attendee line when their calendar is connected for sync, so they get exactly one event (the
  API push), not two. If you change the notification code, preserve that or you'll reintroduce
  duplicate calendar entries.
- **`APP_SECRET` is load-bearing for stored tokens.** Rotating it invalidates all encrypted OAuth
  connections; owners must reconnect. Choose it once, keep it secret, back it up.
- **SMS uses ONE shared number for the whole deployment by default.** On a multi-business hub, every
  business texts from the same `TWILIO_*` number/account/A2P registration — shared branding, reputation,
  and STOP list. For per-business isolation, give each business its own number via `bh_tenant_sms`. Don't
  let an agency admin enable SMS without understanding this. See [`docs/SMS.md`](./docs/SMS.md).
- **Never run `db/seed.sql` on production.** It seeds demo tenants that then clutter the admin
  console and must be deleted by hand.

---

## 4. Environment variable reference

Authoritative source with inline docs: **`.env.example`**. Summary:

| Variable | When | Notes |
|----------|------|-------|
| `APP_MODE` | always | `demo` or `prod`. Start with `demo`. |
| `SLOTTER_EDITION` | always | `agency` (default) or `market`. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | always | Supabase → Settings → API. |
| `BH_API_KEY` | always | Must equal `bh_secrets.api_key` in the DB. `openssl rand -hex 32`. |
| `APP_SECRET` | always | Encrypts tokens + signs sessions. `openssl rand -hex 32`. Don't rotate casually. |
| `NEXT_PUBLIC_BASE_URL` | always | Public URL; used in emails, embeds, OAuth redirects. |
| `ADMIN_EMAILS` | recommended | Comma-separated; who can reach `/admin`. |
| `OWNER_NOTICE_BCC` | optional | BCC every owner notice to an ops inbox. |
| `CRON_SECRET` | optional | Protects `/api/cron/reminders` for manual triggers. |
| `ERROR_WEBHOOK_URL` | optional | Slack-compatible error alerts. Health is always at `/api/health`. |
| `NEXT_PUBLIC_APP_NAME` | optional | Product name in UI + email (default `Slotter`). Non-sensitive on Vercel. |
| `APP_ICS_DOMAIN` | optional | Domain for `.ics` UIDs + organizer address. |
| `NEXT_PUBLIC_HIDE_ATTRIBUTION` | optional | `true` hides the footer credit. Non-sensitive on Vercel. |
| `RESEND_API_KEY` | prod | Real email. |
| `MAIL_FROM` | prod | **Bare** verified address. |
| `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` | optional | Google Calendar (both or neither). |
| `MS_OAUTH_CLIENT_ID` / `_SECRET` / `MS_OAUTH_TENANT` | optional | Outlook/Microsoft 365. |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_FROM` | optional | SMS (all three or none). |
| `SLOTTER_BILLING` + `STRIPE_PLATFORM_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_BILLING_WEBHOOK_SECRET` | market only | Charge business owners. |
| *(per-tenant Stripe)* | optional | Stored in `bh_tenant_payments`, not env. |

---

## 5. Where things live (repo map)

- `db/schema.sql` — full schema + RLS + RPCs. `db/migrations/` — additive upgrades. `db/seed.sql` — demo data.
- `lib/env.ts` — env resolution + which vars are required per mode (source of truth for validation).
- `lib/brand.ts`, `lib/edition.ts` — branding + edition flags.
- `lib/booking.ts` — booking creation, notifications, `.ics`, calendar sync trigger.
- `lib/calendar.ts`, `lib/services/calendar.ts` — two-way sync orchestration + provider adapters.
- `lib/services/` — the ports-and-adapters (`getServices()` switches demo/prod).
- `app/api/*` — route handlers (`/api/health`, `/api/book`, `/api/slots`, `/api/calendar/*`, `/api/webhooks/stripe`, `/api/billing/*`, `/api/cron/reminders`).
- `app/dashboard/*`, `app/admin/*`, `app/b/[slug]/*` — owner dashboard, admin console, public booking pages.
- `docs/` — `HOSTING-GUIDE.md`, `CALENDAR-SYNC.md`, `PAYMENTS.md`, `EDITIONS.md`, `BOOKING-MODES.md`.
- `scripts/check-env.mjs` (`npm run setup:check`), `scripts/verify-setup.mjs` (`npm run verify`).

---

## 6. Definition of done

1. `npm run setup:check` → 0 errors.
2. `npm run verify -- <url>` → `ok:true`, `db:up`, expected `mode`/`edition`.
3. A real booking on a real `/b/<slug>` sends the customer email and (if calendar wired) creates
   exactly one owner calendar event.
4. Test data cleaned up. Secrets only in the host's env store, never committed.

If something fights you, re-read §3. Almost every real-world setup failure is in that list.
