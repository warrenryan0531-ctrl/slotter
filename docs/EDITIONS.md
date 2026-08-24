# Editions: agency vs market

Slotter ships as one codebase that runs as two different products, selected by a single
environment variable, `SLOTTER_EDITION`. Everything that takes a booking — the four modes,
two-way calendar sync, SMS, deposits/refunds, waitlists — is identical in both. Only the
go-to-market surface differs.

| | **Agency** (`SLOTTER_EDITION=agency`, default) | **Market** (`SLOTTER_EDITION=market`) |
|---|---|---|
| Who it's for | An agency/host running booking for many client businesses | A product strangers sign up for themselves |
| Tenancy | Multi-tenant hub; the host provisions each business | Each signup owns one business |
| Public signup | Off — `/signup` returns 404 | On — `/signup` + onboarding wizard |
| Home page `/` | Internal demo picker | Marketing landing with "Start free" |
| New business created by | Admin console (`/admin`) or SQL | The visitor, self-serve |
| Attribution footer | Off (white-label) — set `NEXT_PUBLIC_HIDE_ATTRIBUTION=true` | On ("scheduling by Slotter") |
| Billing | None (the agency bills its clients) | Optional Stripe-subscription seam (`lib/billing.ts`) |

## How the switch works

`lib/edition.ts` reads `SLOTTER_EDITION` once at startup and exposes `isMarket()` / `isAgency()`.
Edition is enforced in the route **handlers**, not just the UI: the public-signup page and its
API both return 404 in the agency edition, and admin business-creation stays behind `ADMIN_EMAILS`
regardless of edition. So an agency build cannot be used to self-provision a tenant, and a market
build doesn't expose the admin-only tenant tools.

## Building each edition

Set the variable in the environment (Vercel project setting, or `.env.local`):

```bash
# Agency (default) — white-label hub for a portfolio of clients
SLOTTER_EDITION=agency
NEXT_PUBLIC_HIDE_ATTRIBUTION=true

# Market — self-serve product
SLOTTER_EDITION=market
```

Both editions run the same `db/schema.sql`. This repo is distributed as two pre-configured
packages (`slotter-agency` and `slotter-market`) whose only difference is the `.env.example`
defaults above — the source is identical.
