-- Slotter v2 · E4 — booking depth: no-show, refunds, waitlist, pay-in-full. Additive.

-- Pay-in-full option (vs deposit) per service.
alter table bh_services add column if not exists pay_mode text not null default 'deposit'
  check (pay_mode in ('deposit','full'));

-- No-show marking (owner action).
create or replace function bh_mark_no_show(p_tenant_id uuid, p_booking_id uuid, p_value boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  update bh_bookings set no_show = coalesce(p_value,true)
    where id = p_booking_id and tenant_id = p_tenant_id;
  if not found then return false; end if;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, 'notified', 'owner', jsonb_build_object('kind','no_show','value',coalesce(p_value,true)));
  return true;
end $$;

-- Refund (R2): atomic paid→refunded transition; the app only calls Stripe when this fires.
-- Idempotent — a second call after refunded returns transitioned=false. Amount echoed for the
-- caller to pass to Stripe (server-side source of truth).
create or replace function bh_refund_booking(p_booking_id uuid, p_amount_cents int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_amt int; v_dep int;
begin
  perform bh_guard();
  select deposit_cents into v_dep from bh_bookings where id = p_booking_id;
  update bh_bookings set payment_status = 'refunded'
    where id = p_booking_id and payment_status = 'paid'
    returning coalesce(p_amount_cents, deposit_cents) into v_amt;
  if not found then return jsonb_build_object('ok', true, 'transitioned', false); end if;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, 'notified', 'system', jsonb_build_object('kind','refund','amount_cents', v_amt));
  return jsonb_build_object('ok', true, 'transitioned', true, 'amount_cents', coalesce(v_amt, v_dep, 0));
end $$;

-- ---- Waitlist (R4) ----
create table if not exists bh_waitlist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references bh_tenants(id) on delete cascade,
  event_id uuid references bh_events(id) on delete cascade,
  customer jsonb not null,
  sms_consent boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting','claimed','expired')),
  created_at timestamptz not null default now()
);
create index if not exists bh_waitlist_event on bh_waitlist (event_id, status);
alter table bh_waitlist enable row level security;
drop policy if exists bh_app_key_all on bh_waitlist;
create policy bh_app_key_all on bh_waitlist for all to anon, authenticated using (bh_check_key()) with check (bh_check_key());

create or replace function bh_join_waitlist(p_event_id uuid, p_customer jsonb, p_sms_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_id uuid;
begin
  perform bh_guard();
  select tenant_id into v_tid from bh_events where id = p_event_id and active;
  if v_tid is null then raise exception 'event not found'; end if;
  insert into bh_waitlist (tenant_id, event_id, customer, sms_consent)
    values (v_tid, p_event_id, p_customer, coalesce(p_sms_consent,false)) returning id into v_id;
  return v_id;
end $$;

-- Atomic promote: claim exactly one waiter (FOR UPDATE SKIP LOCKED), and only if a seat is free.
-- Registers them into the freed seat via the same capacity-guarded insert path, so a physical
-- over-book stays impossible. Returns the created booking id + customer, or null if nothing to do.
create or replace function bh_promote_waitlist(p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev bh_events%rowtype; v_taken int; v_w record; v_bid uuid; v_token text; v_uid text;
begin
  perform bh_guard();
  select * into v_ev from bh_events where id = p_event_id and active for update;
  if v_ev.id is null then return jsonb_build_object('promoted', false); end if;
  select count(*) into v_taken from bh_bookings where event_id = p_event_id and status in ('confirmed','pending');
  if v_taken >= v_ev.capacity then return jsonb_build_object('promoted', false); end if;

  select * into v_w from bh_waitlist
    where event_id = p_event_id and status = 'waiting'
    order by created_at asc for update skip locked limit 1;
  if v_w.id is null then return jsonb_build_object('promoted', false); end if;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  v_uid := gen_random_uuid()::text;
  insert into bh_bookings (tenant_id, service_id, staff_id, event_id, customer, intake_answers,
    starts_at, ends_at, buffer_before_min, buffer_after_min, timespan, status, is_exclusive, sms_consent, manage_token, ics_uid)
  values (v_ev.tenant_id, v_ev.service_id, v_ev.staff_id, p_event_id, v_w.customer, '{}'::jsonb,
    v_ev.starts_at, v_ev.ends_at, 0, 0, 'empty', 'confirmed', false, v_w.sms_consent, v_token, v_uid)
  returning id into v_bid;
  update bh_waitlist set status = 'claimed' where id = v_w.id;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (v_bid, 'created', 'system', jsonb_build_object('kind','waitlist_promote','event_id',p_event_id));
  return jsonb_build_object('promoted', true, 'booking_id', v_bid, 'manage_token', v_token, 'customer', v_w.customer);
end $$;
