-- Per-user dashboard appearance preferences (accent + background), scoped so the same
-- person can theme their admin view and their owner view independently.
-- scope: 'owner' (the tenant dashboard) | 'admin' (the admin panel).
create table if not exists bh_user_prefs (
  scope       text not null,
  email       text not null,
  accent      text not null default 'teal',
  background  text not null default 'mint',
  updated_at  timestamptz not null default now(),
  primary key (scope, email)
);

alter table bh_user_prefs enable row level security;

-- Gated by the same app-key RLS as every other table (the app mints x-bh-key; bh_check_key() enforces it).
drop policy if exists bh_app_key_all on bh_user_prefs;
create policy bh_app_key_all on bh_user_prefs
  for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
