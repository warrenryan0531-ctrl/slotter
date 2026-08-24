-- Slotter v2 · H1 — verify the owner's email BEFORE creating their business (market signup).
-- The pending signup is parked here with a hashed code; the tenant is only created on verify.
create table if not exists bh_signup_pending (
  email text primary key,
  business jsonb not null,          -- {businessName, slug, tz, ownerName}
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table bh_signup_pending enable row level security;
drop policy if exists bh_app_key_all on bh_signup_pending;
create policy bh_app_key_all on bh_signup_pending for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
