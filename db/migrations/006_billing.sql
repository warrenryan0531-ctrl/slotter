-- Slotter v2 · H5 — market-edition billing meter. Tracks each business's plan/subscription.
-- This is the PLATFORM charging the business owner (Slotter's own Stripe), distinct from
-- bh_tenant_payments (each tenant's own Stripe for taking customer deposits).
create table if not exists bh_tenant_billing (
  tenant_id uuid primary key references bh_tenants(id) on delete cascade,
  plan text not null default 'free',                 -- 'free' | 'pro'
  status text not null default 'active',             -- 'active' | 'past_due' | 'canceled'
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table bh_tenant_billing enable row level security;
drop policy if exists bh_app_key_all on bh_tenant_billing;
create policy bh_app_key_all on bh_tenant_billing for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
