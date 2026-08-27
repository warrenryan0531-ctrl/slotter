-- ============================================================
-- v2 · B1 Layer B — Zoom as a first-class video-meeting provider (added 2026-08).
-- Mirrors bh_calendar_connections: per-staff OAuth connection, AES-256-GCM-encrypted tokens
-- (keyed by APP_SECRET, never stored in the DB), refreshed server-side. A video-service booking
-- prefers a connected Zoom account (creates a real Zoom meeting; join link on the booking);
-- otherwise it falls back to the calendar-minted Google Meet / Teams link (Layer A).
-- The Zoom meeting id is stored under the 'zoom' key of bh_bookings.external_event_ref so the
-- cancel path can delete the meeting (same reconciliation idea as calendar events).
-- ============================================================

create table if not exists bh_meeting_connections (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  provider text not null check (provider in ('zoom')),
  account_email text,
  access_token_enc text,               -- AES-256-GCM, keyed by APP_SECRET (never in DB)
  refresh_token_enc text,
  token_expiry timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table bh_meeting_connections enable row level security;
drop policy if exists bh_app_key_all on bh_meeting_connections;
create policy bh_app_key_all on bh_meeting_connections
  for all using (bh_check_key()) with check (bh_check_key());
