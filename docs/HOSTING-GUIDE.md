# Hosting & managing Slotter

This is the practical guide for the person who **runs** a Slotter deployment — installing it, adding businesses to it, and keeping it healthy. If you just want to understand the booking types, read `docs/BOOKING-MODES.md` first. If you want to hack on the code, see `CONTRIBUTING.md`.

## Who does what

Slotter has two kinds of people, and it helps to keep them straight:

- **You, the host / operator.** You deploy the app, own the database, and set up each business (create its tenant row, its staff, and its services). Some things — creating a service, enabling deposits, wiring Stripe, marking a class as a group — are done in SQL, so they're yours.
- **The business owner.** Once you've set them up, they sign in to `/dashboard` with a passwordless email code and run their own day-to-day: setting weekly availability, blocking days off, approving requests, publishing class times, editing branding and reminder timing, and flipping a service between auto-confirm and approve-each.

The short version: **you provision, they operate.** Most weeks, once a business is set up, you won't need to touch anything for it.

## The mental model: one deployment, many businesses

Slotter is multi-tenant. A single deployment (one app on Vercel, one database) serves many businesses. Each business is a **tenant** with its own URL slug (`/b/coastal-shine`), its own branding, staff, services, and availability. Adding a business is adding rows, not standing up new infrastructure. That's what makes this economical to run for an agency or a portfolio of clients.

## 1 · Get it running

Follow the **Quick start** in `README.md` to get the app running locally in demo mode against a free Supabase project: run `db/schema.sql`, then `db/seed.sql` for three worked-example businesses, copy `.env.example` to `.env.local`, and `npm run dev`. Spend ten minutes clicking through the demo tenants and signing into the dashboard — it's the fastest way to understand the whole system before you add your own business.

## 2 · Onboard a new business

Here's the full sequence to add a real business. Run it in the Supabase SQL editor (or wire it into your own admin tooling later). Replace the bracketed values.

**a. Create the tenant.**

```sql
insert into bh_tenants (slug, name, tz, ics_token, branding)
values (
  'blue-ridge-barbers',                 -- URL slug: /b/blue-ridge-barbers
  'Blue Ridge Barbers',
  'America/New_York',                   -- IANA timezone — this drives all slot math
  gen_random_uuid()::text,              -- unique calendar-feed token; any unique string
  '{"accent":"#1d4ed8","tagline":"Sharp since 2012."}'::jsonb
)
returning id;                            -- copy this tenant id for the next steps
```

**b. Add staff.** At least one must be the owner (`is_owner = true`); the owner's email is how they log in.

```sql
insert into bh_staff (tenant_id, name, email, is_owner) values
  ('<TENANT_ID>', 'Sam (Owner)', 'sam@blueridge.example', true),
  ('<TENANT_ID>', 'Alex',        'alex@blueridge.example', false)
returning id;
```

**c. Set each staff member's weekly hours.** `weekday` is 0=Sunday … 6=Saturday; times are minutes past midnight (540 = 9:00 AM, 1020 = 5:00 PM). This example is Mon–Fri 9–5 for one staffer:

```sql
insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
select '<STAFF_ID>', wd, 540, 1020 from generate_series(1,5) wd;
```

(The owner can edit all of this later in the dashboard under **Availability** — this just gives them a sensible starting point.)

> **You can now do most of this in the dashboard instead of SQL.** Owners create and edit services (every mode, pricing, deposits, group capacity, intake questions) and manage staff right in **Dashboard → Services**, and admins create businesses from **/admin**. The SQL below is still the fastest way to script bulk setup or seed a new deployment, and it's what the demo seed uses — but it's no longer the only way.

**d. Add services.** Pick the mode per service using `docs/BOOKING-MODES.md`. A minimal instant service:

```sql
insert into bh_services
  (tenant_id, name, description, duration_min, buffer_after_min, price_cents, kind, location_mode, booking_mode)
values
  ('<TENANT_ID>', 'Haircut', 'Classic cut + hot-towel finish.', 30, 5, 3500, 'appointment', 'business', 'instant')
returning id;

insert into bh_service_staff (service_id, staff_id) values ('<SERVICE_ID>', '<STAFF_ID>');
```

**e. Hand off the dashboard.** Tell the owner to go to `/dashboard`, enter their email, and use the code that's emailed to them (in demo mode the code is always `123456`). From there they're self-sufficient.

> The demo seed (`db/seed.sql`) is a complete, working example of all of the above for three businesses — copy from it rather than typing from scratch.

## 3 · What the owner can do without you

Once set up, the owner self-serves all of this in `/dashboard`, no SQL and no host involvement:

- Set and change weekly **availability**, and block specific days/times off.
- **Approve or decline** pending requests (V2).
- Switch any service between **auto-confirm and approve-each**.
- Publish and cancel **class sessions** for group services (V4).
- Edit **branding** (accent color, tagline) and **reminder timing**.
- Turn a service on or off and see all upcoming **bookings**.

What they *can't* do from the dashboard (so it stays your job): create a brand-new service, enable deposits, or wire up Stripe. Those are deliberate host actions.

## 4 · Going to production

Demo mode is for evaluating and building. To take real bookings:

1. **Set `APP_MODE=prod`** in your Vercel environment variables.
2. **Email:** create a [Resend](https://resend.com) account, verify your sending domain, and set `RESEND_API_KEY` and `MAIL_FROM` (a verified From address). In prod, login codes and all notifications are emailed for real.
3. **Secrets:** set a strong, unique `BH_API_KEY` (matching the value in your `schema.sql`) and `APP_SECRET`. Never reuse the demo placeholders.
4. **Reminders:** `vercel.json` already registers the hourly reminder cron — nothing to do beyond deploying. Optionally set `CRON_SECRET` if you want to be able to trigger `/api/cron/reminders` by hand.
5. **Deposits (only for V3 services):** give each paying tenant their own Stripe keys in `bh_tenant_payments`, **and create a Stripe webhook** pointing at `/api/webhooks/stripe` subscribed to `checkout.session.completed` — without it, deposits charge but bookings never confirm. Full steps + a copy-paste checklist are in **[docs/PAYMENTS.md](./PAYMENTS.md)**. Money flows to the tenant's account; Slotter never holds it.

A good pattern: run one deployment in demo mode as a permanent showroom, and a second in prod for live clients.

## 5 · Day-to-day operation

Most days there's nothing to do — the app runs itself. When you do need to reach in:

- **The `/admin` console.** Emails listed in the `ADMIN_EMAILS` env var can sign in at `/admin` for a cross-tenant support view. Keep this list short and use real addresses you control.
- **Reminders** fire from the hourly cron; each reminder is sent once per booking per configured offset (the owner sets the offsets, e.g. 24h before). It's safe if the cron runs more or less often — the idempotency is handled for you.
- **Abandoned paid holds** are swept automatically, so a slot never stays locked because someone bailed at checkout.

## 6 · Troubleshooting

- **"Missing required env: …" on startup.** A required variable isn't set for the current `APP_MODE`. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `BH_API_KEY`, and `APP_SECRET` are always required; `RESEND_API_KEY` and `MAIL_FROM` are additionally required when `APP_MODE=prod`.
- **Every database call fails / "unauthorized."** `BH_API_KEY` in your env doesn't match the `api_key` value in the database (`bh_secrets` table, set from `schema.sql`). Make them identical.
- **An owner can't log in.** Their email must exactly match a staff row with `is_owner = true` for that tenant. In prod, also confirm email is actually sending (Resend domain verified, `MAIL_FROM` valid).
- **No time slots appear.** Check that the staff member has `bh_availability_rules`, that the service is linked to that staff via `bh_service_staff`, and that the tenant's timezone is correct.
- **A class shows no sessions.** Group services need **events** — the owner publishes them under **Classes**, or you seed them into `bh_events`. A class with no future events simply has nothing to book.
- **Deposits aren't charging in production.** The tenant needs an active `bh_tenant_payments` row with valid Stripe keys, and the service needs `requires_payment = true` with a `deposit_cents` amount.
- **Deposits charge but bookings never confirm.** The Stripe webhook isn't set up. Bookings confirm on the `checkout.session.completed` webhook, not the redirect — see `docs/PAYMENTS.md`.

## 7 · Where things live

- `db/schema.sql` — the entire database. Run once on a fresh project.
- `db/seed.sql` — three demo businesses covering all four modes. Optional, re-runnable.
- `lib/brand.ts` — product name and calendar domain, all from env. Rebrand here (or just set the env vars).
- `lib/engine/` — the timezone-aware slot math, as pure tested functions.
- `app/api/cron/reminders/` — the reminder + hold-sweep runner the cron hits.
- `docs/BOOKING-MODES.md` — the per-version reference you'll return to when adding services.
