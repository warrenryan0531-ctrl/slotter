-- Slotter · per-tenant SMS sender (optional). Additive; safe on an existing database.
--
-- By default the whole deployment sends texts from ONE Twilio number (the TWILIO_* env vars) — so
-- every business on a multi-tenant hub shares that number, account, and A2P registration. This table
-- lets a business use its OWN purchased Twilio number instead. If a tenant has an active row here, its
-- texts go out from its own number; otherwise it falls back to the deployment-wide number (if any).
-- See docs/SMS.md for when to use which, and the compliance/branding tradeoffs.

create table if not exists bh_tenant_sms (
  tenant_id uuid primary key references bh_tenants(id) on delete cascade,
  twilio_account_sid text,
  twilio_auth_token text,
  twilio_from text,           -- this business's own Twilio number, E.164 (e.g. +19045551234)
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Same app-key gate as every other sensitive table: only reachable with the minted x-bh-key header.
alter table bh_tenant_sms enable row level security;
drop policy if exists bh_app_key_all on bh_tenant_sms;
create policy bh_app_key_all on bh_tenant_sms for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
