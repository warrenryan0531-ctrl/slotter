# Paid bookings & deposits (V3) — production setup

Slotter can require a deposit before a slot is confirmed (booking mode **V3**, see `docs/BOOKING-MODES.md`). In **demo mode** this "just works" — a built-in test checkout page stands in for Stripe and no real money moves. In **production** there are a few required steps, and **one of them is easy to miss in a way that silently breaks paid bookings.** Read this whole page before you turn on real deposits.

## How a paid booking actually confirms

This is the part people get wrong, so it's first:

1. The customer finishes the booking and is sent to a **Stripe Checkout** page for the deposit. The booking is created as `pending` / `awaiting` payment — the slot is *held* but not confirmed.
2. The customer pays.
3. **Stripe calls your webhook** (`POST /api/webhooks/stripe`) with a `checkout.session.completed` event. *This* is what flips the booking to `confirmed` / `paid` and sends the confirmation + calendar invite.
4. If the customer never pays, a background sweep releases the hold after ~40 minutes so the slot never stays locked.

> ⚠️ **The confirmation happens on the webhook, not on the "thank you" redirect.** If you skip the webhook setup below, customers will be charged their deposit but their bookings will **never confirm** — they'll sit `pending` forever and no invite goes out. This is the single most important step on this page.

## What you need per paying tenant

Each business takes deposits into **its own Stripe account** — Slotter never holds funds or touches card data. So the setup is per-tenant.

### Step 1 — Collect the tenant's Stripe keys

From the tenant's Stripe Dashboard (**Developers → API keys**):

- Secret key (`sk_live_...`)
- Publishable key (`pk_live_...`)

### Step 2 — Create the webhook endpoint in Stripe

In the tenant's Stripe Dashboard (**Developers → Webhooks → Add endpoint**):

1. **Endpoint URL:** `https://YOUR-SLOTTER-HOST/api/webhooks/stripe`
   (the same host for every tenant — Slotter matches the event to the right tenant by trying each active tenant's signing secret).
2. **Events to send:** subscribe to **`checkout.session.completed`** (that's the only one Slotter acts on).
3. Create the endpoint, then copy its **Signing secret** (`whsec_...`).

### Step 3 — Store the keys in Slotter

Put all three into the tenant's `bh_tenant_payments` row and mark it active:

```sql
insert into bh_tenant_payments
  (tenant_id, stripe_secret_key, stripe_publishable_key, stripe_webhook_secret, active)
values
  ('<TENANT_ID>', 'sk_live_...', 'pk_live_...', 'whsec_...', true)
on conflict (tenant_id) do update
  set stripe_secret_key      = excluded.stripe_secret_key,
      stripe_publishable_key = excluded.stripe_publishable_key,
      stripe_webhook_secret  = excluded.stripe_webhook_secret,
      active                 = true;
```

### Step 4 — Mark the service as paid

On the service that should require a deposit, set the amount (in cents):

```sql
update bh_services
  set requires_payment = true, deposit_cents = 5000   -- $50.00
  where id = '<SERVICE_ID>';
```

## Production paid-bookings checklist

Run through this once per paying tenant before taking real money:

- [ ] `APP_MODE=prod` in the deployment's environment.
- [ ] Tenant's `sk_live_...` and `pk_live_...` stored in `bh_tenant_payments`.
- [ ] Stripe webhook endpoint created, pointing at `https://YOUR-HOST/api/webhooks/stripe`.
- [ ] Webhook subscribed to **`checkout.session.completed`**.
- [ ] Webhook signing secret (`whsec_...`) stored in `bh_tenant_payments.stripe_webhook_secret`.
- [ ] `bh_tenant_payments.active = true` for the tenant.
- [ ] Service has `requires_payment = true` and a non-null `deposit_cents`.
- [ ] End-to-end test with a real (small) deposit or Stripe test mode: pay, then confirm the booking flips to `confirmed` and the invite arrives.

## Verifying it works

After setup, make one test booking on the paid service and pay the deposit. Then:

- In Slotter, the booking should move from `pending`/`awaiting` to `confirmed`/`paid`, and the customer should receive their confirmation + `.ics` invite.
- In Stripe (**Developers → Webhooks → your endpoint**), the `checkout.session.completed` delivery should show a `200` response. A non-200 (or no delivery) means Slotter rejected or never received it — recheck the URL and that the stored `whsec_...` matches this exact endpoint.

## Troubleshooting

- **Deposit charged, booking still pending.** The webhook isn't reaching Slotter or the signature isn't verifying. Check: endpoint URL is exactly `/api/webhooks/stripe`, the event is `checkout.session.completed`, and the stored `stripe_webhook_secret` is the signing secret **for that endpoint** (each endpoint has its own).
- **Checkout never appears.** The service isn't marked paid (`requires_payment`/`deposit_cents`) or the tenant's `bh_tenant_payments` row isn't `active` with a valid `sk_live_...`.
- **Works for one tenant, not another.** Each tenant needs its **own** endpoint + signing secret stored on its **own** row. Slotter identifies the tenant by matching the incoming signature against each active tenant's secret.
