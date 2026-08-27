-- ============================================================
-- v2 · B2 — review-request automation (added 2026-08). Post-visit review asks.
--
-- Selects confirmed, completed, non-no-show bookings whose end is in the
-- [delay, delay+window) hours-ago band and that haven't already been asked.
-- Idempotency + the atomic claim reuse the existing reminder machinery:
--   bh_claim_reminder(booking_id, 'review')  →  a 'notified' event with kind='review',
--   deduped by the existing bh_reminder_once unique index.
-- The bounded lower window is what prevents enabling the feature from blasting
-- a review ask at every historical booking — only recently-completed ones qualify.
--
-- TENANT SCOPING: these selection RPCs are SECURITY DEFINER (they bypass RLS), so they
-- MUST filter by tenant themselves. The cron loops per tenant and passes p_tenant_id; without
-- this filter a single tenant's pass would claim + send other tenants' bookings under the wrong
-- brand/URL. The pre-existing bh_due_reminders had the same gap and is fixed here alongside B2.
-- ============================================================

-- Fix the reminders selector: add a tenant filter (drop first — arity change).
drop function if exists bh_due_reminders(text, numeric);
create or replace function bh_due_reminders(p_tenant_id uuid, p_kind text, p_hours numeric)
returns table (booking_id uuid, tenant_id uuid) language sql security definer set search_path = public as $$
  select b.id, b.tenant_id from bh_bookings b
  where b.tenant_id = p_tenant_id
    and b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + (p_hours * interval '1 hour')
    and not exists (select 1 from bh_booking_events e
      where e.booking_id = b.id and e.type = 'notified' and e.payload->>'kind' = p_kind);
$$;

-- B2: post-visit review-request selection, tenant-scoped.
create or replace function bh_due_review_requests(p_tenant_id uuid, p_delay_hours numeric, p_window_hours numeric default 48)
returns table (booking_id uuid, tenant_id uuid) language sql security definer set search_path = public as $$
  select b.id, b.tenant_id from bh_bookings b
  where b.tenant_id = p_tenant_id
    and b.status = 'confirmed'
    and coalesce(b.no_show, false) = false
    and b.ends_at <= now() - (p_delay_hours * interval '1 hour')
    and b.ends_at >  now() - ((p_delay_hours + p_window_hours) * interval '1 hour')
    and not exists (
      select 1 from bh_booking_events e
      where e.booking_id = b.id and e.type = 'notified' and e.payload->>'kind' = 'review'
    );
$$;
