-- Slotter v2 · E1 — two-way calendar sync. Additive; safe on an existing database.

-- Per-staff connected calendars. Tokens are AES-256-GCM encrypted at the APP layer
-- (keyed by APP_SECRET, which never lives in the DB) before being stored here, so the
-- ciphertext is useless to anything holding only the app key or a DB dump.
create table if not exists bh_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft','demo')),
  external_calendar_id text,           -- provider calendar id ('primary' for google)
  account_email text,
  access_token_enc text,               -- encrypted; null for demo
  refresh_token_enc text,              -- encrypted; null for demo
  token_expiry timestamptz,
  block_busy boolean not null default true,   -- read freebusy → block slots (FR-E1.2)
  sync_events boolean not null default true,  -- push bookings to this calendar (FR-E1.3)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bh_calconn_staff on bh_calendar_connections (staff_id);

-- Durable freebusy cache (R5/R7): survives serverless isolates, throttles provider APIs,
-- and is the fallback set when a provider call errors (never silently drop real busy time).
create table if not exists bh_freebusy_cache (
  staff_id uuid not null references bh_staff(id) on delete cascade,
  day date not null,
  busy jsonb not null default '[]',    -- [{start,end}] UTC ms
  fetched_at timestamptz not null default now(),
  primary key (staff_id, day)
);

-- Track the external event id(s) we pushed, per connection, so we can update/delete them
-- and filter our own events out of freebusy (R3 self-collision).
alter table bh_bookings add column if not exists external_event_ref jsonb not null default '{}';
-- No-show marking (E4) — added here so bookings has it early.
alter table bh_bookings add column if not exists no_show boolean not null default false;

-- RLS: same app-key gate as every other table.
alter table bh_calendar_connections enable row level security;
alter table bh_freebusy_cache enable row level security;
drop policy if exists bh_app_key_all on bh_calendar_connections;
create policy bh_app_key_all on bh_calendar_connections for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
drop policy if exists bh_app_key_all on bh_freebusy_cache;
create policy bh_app_key_all on bh_freebusy_cache for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
