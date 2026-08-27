-- ============================================================
-- v2 · Hardening pass (added 2026-08).
--   1) B3 durable pre-charge marker — closes the narrow >24h duplicate-capture edge.
--   2) B5 orphaned-upload tracking — a cron sweep GC's abandoned intake files.
-- ============================================================

-- 1) B3: "a fee charge has been attempted for this booking and we don't yet have a confirmed outcome."
-- Set BEFORE calling Stripe, cleared on confirmed success. On a retry with this flag still set, the
-- charge path MUST reconcile with Stripe (search for a prior succeeded PaymentIntent) before it may
-- create a new one — and if it cannot reconcile, it refuses rather than risk a second charge. This
-- makes a double charge impossible even when the Stripe idempotency key has expired AND search is
-- momentarily unavailable, because a duplicate can only follow a prior attempt (flag set → reconcile).
alter table bh_bookings add column if not exists fee_charge_pending boolean not null default false;

-- 2) B5: every minted upload URL is recorded here. The sweep deletes rows older than a grace window;
-- if a booking references the path the object is kept (row dropped), otherwise the storage object is
-- deleted too. Bounds the sweep to recent uploads instead of scanning the whole bucket.
create table if not exists bh_intake_uploads (
  path text primary key,
  tenant_slug text not null,
  created_at timestamptz not null default now()
);
alter table bh_intake_uploads enable row level security;
drop policy if exists bh_app_key_all on bh_intake_uploads;
create policy bh_app_key_all on bh_intake_uploads
  for all using (bh_check_key()) with check (bh_check_key());

-- Allow the server's anon role to DELETE objects in the intake bucket (the sweep). Insert/select
-- policies already exist from migration 012; customers/owners still only get scoped signed URLs.
--   create policy "intake anon delete" on storage.objects for delete to anon using (bucket_id = 'intake');

-- Is an intake object referenced by any booking? (The path — slug/uuid/safe-name — contains no LIKE
-- metacharacters, and p_path is a bind parameter, so this is injection-safe.) Used by the sweep to
-- decide whether an aged, tracked upload is a real attachment (keep) or an orphan (delete).
create or replace function bh_intake_path_used(p_path text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from bh_bookings where intake_answers::text like '%' || p_path || '%');
$$;
