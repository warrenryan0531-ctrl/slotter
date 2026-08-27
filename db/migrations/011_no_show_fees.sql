-- ============================================================
-- v2 · B3 — no-show & late-cancellation fees (card-on-file). Added 2026-08.
--
-- A service can be marked "protected": the customer vaults a card at booking via a Stripe
-- SetupIntent (NO charge), on the TENANT'S OWN connected Stripe account (this app never touches PCI).
-- If they no-show or cancel late, the OWNER (never an automated rule in this version) charges a
-- one-time fee off-session. All additive; bh_tenant_payments is unchanged.
--
-- fee is charged at most once per booking, guarded by booking.fee_charged_cents (null = not charged)
-- plus a Stripe idempotency key on the PaymentIntent.
-- ============================================================

-- Service-level fee configuration.
alter table bh_services add column if not exists protect_no_show boolean not null default false;
alter table bh_services add column if not exists no_show_fee_cents int;
alter table bh_services add column if not exists fee_model text not null default 'flat';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bh_services_fee_model_chk') then
    alter table bh_services add constraint bh_services_fee_model_chk check (fee_model in ('flat','percent'));
  end if;
end $$;

-- Booking-level vaulted-card references + the one-time charge marker.
alter table bh_bookings add column if not exists stripe_customer_id text;
alter table bh_bookings add column if not exists stripe_payment_method_id text;
alter table bh_bookings add column if not exists fee_charged_cents int;
-- The fee AMOUNT disclosed to the customer at booking time, snapshotted so a later change to the
-- service's fee config can never charge them a different amount than they agreed to.
alter table bh_bookings add column if not exists fee_quote_cents int;
