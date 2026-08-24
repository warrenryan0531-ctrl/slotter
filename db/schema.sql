-- Slotter — full database schema (PostgreSQL / Supabase).
-- Run this once against a fresh database. Then run seed.sql for the demo tenants (optional).
-- Tables are prefixed bh_ (historical) — harmless, internal. The app authenticates with the
-- anon key + a secret `x-bh-key` header enforced by RLS + every SECURITY DEFINER function.
--
-- BEFORE RUNNING: set your app secret so the app and the DB agree. Replace REPLACE_WITH_BH_API_KEY
-- below with the same value you put in BH_API_KEY in your .env (any long random string).

create extension if not exists btree_gist;

-- ---------- core tables ----------
create table bh_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  tz text not null default 'America/New_York',
  branding jsonb not null default '{}',
  settings jsonb not null default '{}',
  ics_token text unique not null,
  created_at timestamptz not null default now()
);

create table bh_staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references bh_tenants(id) on delete cascade,
  name text not null,
  email text,
  is_owner boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table bh_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references bh_tenants(id) on delete cascade,
  name text not null,
  description text,
  duration_min integer not null check (duration_min > 0),
  buffer_before_min integer not null default 0 check (buffer_before_min >= 0),
  buffer_after_min integer not null default 0 check (buffer_after_min >= 0),
  price_cents integer,
  kind text not null check (kind in ('call','appointment','onsite')),
  location_mode text not null check (location_mode in ('phone','address','business')),
  active boolean not null default true,
  sort integer not null default 0,
  deposit_cents integer,
  requires_payment boolean not null default false,
  booking_mode text not null default 'instant' check (booking_mode in ('instant','request')),
  capacity integer not null default 1 check (capacity >= 1),
  is_group boolean not null default false
);

create table bh_service_staff (
  service_id uuid not null references bh_services(id) on delete cascade,
  staff_id uuid not null references bh_staff(id) on delete cascade,
  primary key (service_id, staff_id)
);

create table bh_availability_rules (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_min integer not null check (start_min between 0 and 1439),
  end_min integer not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);

create table bh_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  date date not null,
  closed boolean not null default true,
  start_min integer check (start_min between 0 and 1439),
  end_min integer check (end_min between 1 and 1440),
  unique (staff_id, date)
);

create table bh_blocks (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table bh_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references bh_tenants(id) on delete cascade,
  service_id uuid not null references bh_services(id) on delete cascade,
  staff_id uuid not null references bh_staff(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index bh_events_service_start on bh_events (service_id, starts_at);

create table bh_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references bh_tenants(id) on delete cascade,
  service_id uuid not null references bh_services(id),
  staff_id uuid not null references bh_staff(id),
  event_id uuid references bh_events(id) on delete cascade,
  customer jsonb not null,
  intake_answers jsonb not null default '{}',
  address jsonb,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  buffer_before_min integer not null default 0,
  buffer_after_min integer not null default 0,
  timespan tstzrange not null,
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancelled','declined')),
  is_exclusive boolean not null default true,
  sms_consent boolean not null default false,
  manage_token text unique not null,
  ics_uid text not null,
  ics_sequence integer not null default 0,
  payment_status text not null default 'none' check (payment_status in ('none','awaiting','paid','refunded')),
  deposit_cents integer,
  checkout_ref text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  -- Impossible to double-book at the DB level: no two CONFIRMED/PENDING exclusive bookings for one
  -- staff member may overlap (buffers included). Group registrations (is_exclusive=false) are exempt.
  constraint bh_no_overlap exclude using gist (staff_id with =, timespan with &&)
    where (status in ('confirmed','pending') and is_exclusive)
);
create index bh_bookings_tenant_start on bh_bookings (tenant_id, starts_at);
create index bh_bookings_staff_start on bh_bookings (staff_id, starts_at);

-- timespan = buffer-inclusive range, maintained by trigger (a generated column can't do this
-- because tstz +/- interval is STABLE, not IMMUTABLE).
create or replace function bh_set_timespan() returns trigger
language plpgsql as $$
begin
  new.timespan := tstzrange(
    new.starts_at - make_interval(mins => new.buffer_before_min),
    new.ends_at + make_interval(mins => new.buffer_after_min), '[)');
  return new;
end $$;
create trigger bh_bookings_timespan
  before insert or update of starts_at, ends_at, buffer_before_min, buffer_after_min on bh_bookings
  for each row execute function bh_set_timespan();

create table bh_booking_events (
  id bigserial primary key,
  booking_id uuid not null references bh_bookings(id) on delete cascade,
  type text not null check (type in ('created','rescheduled','cancelled','notified')),
  actor text not null check (actor in ('customer','owner','system','admin')),
  payload jsonb not null default '{}',
  at timestamptz not null default now()
);
-- one reminder per booking per kind (idempotency)
create unique index bh_reminder_once on bh_booking_events (booking_id, (payload->>'kind')) where type = 'notified';

create table bh_intake_questions (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references bh_services(id) on delete cascade,
  label text not null,
  type text not null check (type in ('text','textarea','select','phone','address')),
  options jsonb,
  required boolean not null default false,
  sort integer not null default 0
);

create table bh_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);
create index bh_login_codes_email on bh_login_codes (email);

create table bh_outbox_emails (
  id bigserial primary key,
  tenant_id uuid,
  to_addr text not null,
  subject text not null,
  html text not null,
  ics_text text,
  channel text not null default 'email',
  created_at timestamptz not null default now()
);

create table bh_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null default 1
);

-- Per-tenant Stripe credentials for paid bookings (v3). Client's OWN account; empty in demo mode.
create table bh_tenant_payments (
  tenant_id uuid primary key references bh_tenants(id) on delete cascade,
  stripe_secret_key text,
  stripe_publishable_key text,
  stripe_webhook_secret text,
  active boolean not null default false,
  updated_at timestamptz not null default now()
);

-- The app-key secret gate. The app sends header x-bh-key = BH_API_KEY; RLS + functions check it.
create table bh_secrets (name text primary key, value text not null);
insert into bh_secrets (name, value) values ('api_key', 'REPLACE_WITH_BH_API_KEY');

-- ---------- security: RLS + the app-key check ----------
create or replace function bh_check_key() returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce(current_setting('request.headers', true)::json->>'x-bh-key', '')
       = (select value from bh_secrets where name = 'api_key');
exception when others then
  return false;
end $$;

create or replace function bh_guard() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not bh_check_key() and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end $$;

do $$
declare t text;
begin
  foreach t in array array['bh_tenants','bh_staff','bh_services','bh_service_staff','bh_availability_rules',
    'bh_availability_overrides','bh_blocks','bh_bookings','bh_booking_events','bh_intake_questions',
    'bh_login_codes','bh_outbox_emails','bh_rate_limits','bh_events','bh_tenant_payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists bh_app_key_all on %I', t);
    execute format('create policy bh_app_key_all on %I for all to anon, authenticated using (bh_check_key()) with check (bh_check_key())', t);
  end loop;
end $$;
alter table bh_secrets enable row level security;
revoke all on bh_secrets from anon, authenticated;

-- ---------- business logic (SECURITY DEFINER, guarded) ----------
create or replace function bh_rate_limit(p_key text, p_window_secs int, p_max int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  perform bh_guard();
  insert into bh_rate_limits as rl (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when rl.window_start < now() - make_interval(secs => p_window_secs) then 1 else rl.count + 1 end,
        window_start = case when rl.window_start < now() - make_interval(secs => p_window_secs) then now() else rl.window_start end
  returning count into v_count;
  if random() < 0.02 then delete from bh_rate_limits where window_start < now() - interval '1 day'; end if;
  return v_count <= p_max;
end $$;

create or replace function bh_insert_booking(
  p_tenant_id uuid, p_service_id uuid, p_staff_id uuid, p_customer jsonb, p_intake jsonb, p_address jsonb,
  p_starts_at timestamptz, p_ends_at timestamptz, p_buf_before int, p_buf_after int,
  p_sms_consent boolean, p_manage_token text, p_ics_uid text,
  p_status text default 'confirmed', p_payment_status text default 'none', p_deposit_cents int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if p_status not in ('confirmed','pending') then raise exception 'invalid booking status %', p_status; end if;
  perform 1 from bh_staff where id = p_staff_id for update;
  begin
    insert into bh_bookings (tenant_id, service_id, staff_id, customer, intake_answers, address,
      starts_at, ends_at, buffer_before_min, buffer_after_min, timespan, status, sms_consent, manage_token, ics_uid,
      payment_status, deposit_cents)
    values (p_tenant_id, p_service_id, p_staff_id, p_customer, coalesce(p_intake,'{}'::jsonb), p_address,
      p_starts_at, p_ends_at, p_buf_before, p_buf_after, 'empty', p_status, p_sms_consent, p_manage_token, p_ics_uid,
      p_payment_status, p_deposit_cents)
    returning id into v_id;
  exception when exclusion_violation then return jsonb_build_object('ok', false, 'reason', 'conflict'); end;
  if exists (select 1 from bh_blocks b where b.staff_id = p_staff_id
      and b.starts_at < p_ends_at + make_interval(mins => p_buf_after)
      and b.ends_at > p_starts_at - make_interval(mins => p_buf_before)) then
    raise exception 'BH_BLOCKED' using errcode = 'P0904';
  end if;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (v_id, 'created', 'customer', jsonb_build_object('status', p_status, 'payment', p_payment_status));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', p_status);
end $$;

create or replace function bh_decide_booking(p_booking_id uuid, p_decision text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_new text;
begin
  perform bh_guard();
  if p_decision = 'approve' then v_new := 'confirmed';
  elsif p_decision = 'decline' then v_new := 'declined';
  else return jsonb_build_object('ok', false, 'reason', 'bad_decision'); end if;
  update bh_bookings set status = v_new where id = p_booking_id and status = 'pending';
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, case when v_new='confirmed' then 'created' else 'cancelled' end, p_actor,
            jsonb_build_object('decision', p_decision));
  return jsonb_build_object('ok', true, 'status', v_new);
end $$;

create or replace function bh_reschedule_booking(p_booking_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_staff uuid; v_bb int; v_ba int; v_seq int;
begin
  perform bh_guard();
  select staff_id, buffer_before_min, buffer_after_min into v_staff, v_bb, v_ba
    from bh_bookings where id = p_booking_id and status = 'confirmed';
  if v_staff is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from bh_staff where id = v_staff for update;
  begin
    update bh_bookings set starts_at = p_starts_at, ends_at = p_ends_at, ics_sequence = ics_sequence + 1
      where id = p_booking_id returning ics_sequence into v_seq;
  exception when exclusion_violation then return jsonb_build_object('ok', false, 'reason', 'conflict'); end;
  if exists (select 1 from bh_blocks b where b.staff_id = v_staff
      and b.starts_at < p_ends_at + make_interval(mins => v_ba)
      and b.ends_at > p_starts_at - make_interval(mins => v_bb)) then
    raise exception 'BH_BLOCKED' using errcode = 'P0904';
  end if;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, 'rescheduled', p_actor, jsonb_build_object('starts_at', p_starts_at));
  return jsonb_build_object('ok', true, 'sequence', v_seq);
end $$;

create or replace function bh_cancel_booking(p_booking_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seq int;
begin
  perform bh_guard();
  update bh_bookings set status = 'cancelled', ics_sequence = ics_sequence + 1
    where id = p_booking_id and status in ('confirmed','pending') returning ics_sequence into v_seq;
  if v_seq is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  insert into bh_booking_events (booking_id, type, actor) values (p_booking_id, 'cancelled', p_actor);
  return jsonb_build_object('ok', true, 'sequence', v_seq);
end $$;

create or replace function bh_add_block(p_staff_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  perform 1 from bh_staff where id = p_staff_id for update;
  insert into bh_blocks (staff_id, starts_at, ends_at, reason) values (p_staff_id, p_starts_at, p_ends_at, p_reason) returning id into v_id;
  return v_id;
end $$;

create or replace function bh_register_event(
  p_event_id uuid, p_customer jsonb, p_intake jsonb, p_sms_consent boolean, p_manage_token text, p_ics_uid text, p_status text default 'confirmed'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev bh_events%rowtype; v_taken int; v_id uuid;
begin
  perform bh_guard();
  if p_status not in ('confirmed','pending') then raise exception 'invalid status %', p_status; end if;
  select * into v_ev from bh_events where id = p_event_id and active for update;
  if v_ev.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_ev.starts_at <= now() then return jsonb_build_object('ok', false, 'reason', 'past'); end if;
  select count(*) into v_taken from bh_bookings where event_id = p_event_id and status in ('confirmed','pending');
  if v_taken >= v_ev.capacity then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  insert into bh_bookings (tenant_id, service_id, staff_id, event_id, customer, intake_answers,
    starts_at, ends_at, buffer_before_min, buffer_after_min, timespan, status, is_exclusive, sms_consent, manage_token, ics_uid)
  values (v_ev.tenant_id, v_ev.service_id, v_ev.staff_id, p_event_id, p_customer, coalesce(p_intake,'{}'::jsonb),
    v_ev.starts_at, v_ev.ends_at, 0, 0, 'empty', p_status, false, p_sms_consent, p_manage_token, p_ics_uid)
  returning id into v_id;
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (v_id, 'created', 'customer', jsonb_build_object('status', p_status, 'event_id', p_event_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', p_status, 'seats_left', v_ev.capacity - v_taken - 1);
end $$;

create or replace function bh_mark_paid(p_booking_id uuid, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  perform bh_guard();
  update bh_bookings set status='confirmed', payment_status='paid', checkout_ref = coalesce(p_ref, checkout_ref)
    where id = p_booking_id and status='pending' and payment_status='awaiting';
  get diagnostics v_ok = row_count;
  if v_ok then insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, 'created', 'system', jsonb_build_object('payment','paid')); end if;
  return jsonb_build_object('ok', true, 'transitioned', v_ok);
end $$;

create or replace function bh_sweep_unpaid()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  perform bh_guard();
  update bh_bookings set status='cancelled'
    where status='pending' and payment_status='awaiting' and created_at < now() - interval '40 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function bh_claim_reminder(p_booking_id uuid, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  insert into bh_booking_events (booking_id, type, actor, payload)
    values (p_booking_id, 'notified', 'system', jsonb_build_object('kind', p_kind));
  return true;
exception when unique_violation then return false;
end $$;

create or replace function bh_due_reminders(p_kind text, p_hours numeric)
returns table (booking_id uuid, tenant_id uuid) language sql security definer set search_path = public as $$
  select b.id, b.tenant_id from bh_bookings b
  where b.status = 'confirmed' and b.starts_at > now() and b.starts_at <= now() + (p_hours * interval '1 hour')
    and not exists (select 1 from bh_booking_events e
      where e.booking_id = b.id and e.type = 'notified' and e.payload->>'kind' = p_kind);
$$;

-- ============================================================
-- v2 · E1 — two-way calendar sync (added 2026-08). See db/migrations/002_calendar_sync.sql.
-- ============================================================
create table if not exists bh_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references bh_staff(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft','demo')),
  external_calendar_id text,
  account_email text,
  access_token_enc text,               -- AES-256-GCM, keyed by APP_SECRET (never in DB)
  refresh_token_enc text,
  token_expiry timestamptz,
  block_busy boolean not null default true,
  sync_events boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bh_calconn_staff on bh_calendar_connections (staff_id);

create table if not exists bh_freebusy_cache (
  staff_id uuid not null references bh_staff(id) on delete cascade,
  day date not null,
  busy jsonb not null default '[]',
  fetched_at timestamptz not null default now(),
  primary key (staff_id, day)
);

alter table bh_bookings add column if not exists external_event_ref jsonb not null default '{}';
alter table bh_bookings add column if not exists no_show boolean not null default false;

alter table bh_calendar_connections enable row level security;
alter table bh_freebusy_cache enable row level security;
drop policy if exists bh_app_key_all on bh_calendar_connections;
create policy bh_app_key_all on bh_calendar_connections for all to anon, authenticated using (bh_check_key()) with check (bh_check_key());
drop policy if exists bh_app_key_all on bh_freebusy_cache;
create policy bh_app_key_all on bh_freebusy_cache for all to anon, authenticated using (bh_check_key()) with check (bh_check_key());

-- ============================================================
-- v2 · E3 — provisioning RPCs (added 2026-08). See db/migrations/003_provisioning.sql.
-- ============================================================
-- Slotter v2 · E3 — no-SQL provisioning. Guarded SECURITY DEFINER RPCs so owners/admins can
-- manage services, intake questions, staff, and (admin) tenants from the UI. Additive.

-- Upsert a service (insert when p_id is null, else update). Tenant-scoped, guarded.
create or replace function bh_upsert_service(
  p_tenant_id uuid, p_id uuid, p_name text, p_description text, p_duration_min int,
  p_buffer_before_min int, p_buffer_after_min int, p_price_cents int, p_kind text, p_location_mode text,
  p_booking_mode text, p_deposit_cents int, p_requires_payment boolean,
  p_is_group boolean, p_capacity int, p_active boolean, p_sort int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if p_kind not in ('call','appointment','onsite') then raise exception 'bad kind %', p_kind; end if;
  if p_location_mode not in ('phone','address','business') then raise exception 'bad location %', p_location_mode; end if;
  if p_booking_mode not in ('instant','request') then raise exception 'bad booking_mode %', p_booking_mode; end if;
  if p_duration_min <= 0 then raise exception 'duration must be > 0'; end if;
  if p_id is null then
    insert into bh_services (tenant_id, name, description, duration_min, buffer_before_min, buffer_after_min,
      price_cents, kind, location_mode, booking_mode, deposit_cents, requires_payment, is_group, capacity, active, sort)
    values (p_tenant_id, p_name, p_description, p_duration_min, p_buffer_before_min, p_buffer_after_min,
      p_price_cents, p_kind, p_location_mode, p_booking_mode, p_deposit_cents, coalesce(p_requires_payment,false),
      coalesce(p_is_group,false), greatest(coalesce(p_capacity,1),1), coalesce(p_active,true), coalesce(p_sort,0))
    returning id into v_id;
  else
    update bh_services set name=p_name, description=p_description, duration_min=p_duration_min,
      buffer_before_min=p_buffer_before_min, buffer_after_min=p_buffer_after_min, price_cents=p_price_cents,
      kind=p_kind, location_mode=p_location_mode, booking_mode=p_booking_mode, deposit_cents=p_deposit_cents,
      requires_payment=coalesce(p_requires_payment,false), is_group=coalesce(p_is_group,false),
      capacity=greatest(coalesce(p_capacity,1),1), active=coalesce(p_active,true), sort=coalesce(p_sort,0)
    where id=p_id and tenant_id=p_tenant_id returning id into v_id;
    if v_id is null then raise exception 'service not found for tenant'; end if;
  end if;
  return v_id;
end $$;

create or replace function bh_delete_service(p_tenant_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  delete from bh_services where id=p_id and tenant_id=p_tenant_id;
  return found;
end $$;

-- Intake questions: upsert + delete, verified to belong to a service in this tenant.
create or replace function bh_upsert_intake_question(
  p_tenant_id uuid, p_id uuid, p_service_id uuid, p_label text, p_type text, p_options jsonb, p_required boolean, p_sort int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if not exists (select 1 from bh_services where id=p_service_id and tenant_id=p_tenant_id) then raise exception 'service not in tenant'; end if;
  if p_type not in ('text','textarea','select','phone','address') then raise exception 'bad type %', p_type; end if;
  if p_id is null then
    insert into bh_intake_questions (service_id, label, type, options, required, sort)
    values (p_service_id, p_label, p_type, p_options, coalesce(p_required,false), coalesce(p_sort,0)) returning id into v_id;
  else
    update bh_intake_questions set label=p_label, type=p_type, options=p_options, required=coalesce(p_required,false), sort=coalesce(p_sort,0)
    where id=p_id and service_id=p_service_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function bh_delete_intake_question(p_tenant_id uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  delete from bh_intake_questions q using bh_services s
   where q.id=p_id and q.service_id=s.id and s.tenant_id=p_tenant_id;
  return found;
end $$;

-- Staff: upsert + (soft) deactivate; assign a staff set to a service.
create or replace function bh_upsert_staff(
  p_tenant_id uuid, p_id uuid, p_name text, p_email text, p_is_owner boolean, p_active boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform bh_guard();
  if p_id is null then
    insert into bh_staff (tenant_id, name, email, is_owner, active)
    values (p_tenant_id, p_name, p_email, coalesce(p_is_owner,false), coalesce(p_active,true)) returning id into v_id;
  else
    update bh_staff set name=p_name, email=p_email, is_owner=coalesce(p_is_owner,false), active=coalesce(p_active,true)
    where id=p_id and tenant_id=p_tenant_id returning id into v_id;
    if v_id is null then raise exception 'staff not found for tenant'; end if;
  end if;
  return v_id;
end $$;

create or replace function bh_assign_service_staff(p_tenant_id uuid, p_service_id uuid, p_staff_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform bh_guard();
  if not exists (select 1 from bh_services where id=p_service_id and tenant_id=p_tenant_id) then raise exception 'service not in tenant'; end if;
  delete from bh_service_staff where service_id=p_service_id;
  insert into bh_service_staff (service_id, staff_id)
    select p_service_id, s.id from bh_staff s where s.tenant_id=p_tenant_id and s.id = any(p_staff_ids);
end $$;

-- Admin: create a tenant (agency edition). Slug uniqueness enforced by the table.
create or replace function bh_create_tenant(p_slug text, p_name text, p_tz text, p_owner_name text, p_owner_email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_tid uuid; v_sid uuid;
begin
  perform bh_guard();
  insert into bh_tenants (slug, name, tz, ics_token)
    values (lower(trim(p_slug)), p_name, coalesce(p_tz,'America/New_York'), gen_random_uuid()::text)
    returning id into v_tid;
  insert into bh_staff (tenant_id, name, email, is_owner)
    values (v_tid, coalesce(p_owner_name,'Owner'), lower(trim(p_owner_email)), true) returning id into v_sid;
  -- default Mon–Fri 9–5 so the owner can book immediately
  insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
    select v_sid, wd, 540, 1020 from generate_series(1,5) wd;
  return v_tid;
end $$;

-- ============================================================
-- v2 · E4 — booking depth (added 2026-08). See db/migrations/004_booking_depth.sql.
-- ============================================================
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

-- v2 · H1 — signup email verification (added 2026-08). See db/migrations/005_signup_verification.sql.
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

-- v2 · H5 — market billing (added 2026-08). See db/migrations/006_billing.sql.
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

-- Slotter v2 · per-tenant SMS sender (optional; migration 007). By default the whole deployment sends
-- from ONE Twilio number (TWILIO_* env). A tenant with an active row here sends from its OWN purchased
-- number instead (better branding, isolated A2P + reputation); otherwise it falls back to the global
-- number. See docs/SMS.md.
create table if not exists bh_tenant_sms (
  tenant_id uuid primary key references bh_tenants(id) on delete cascade,
  twilio_account_sid text,
  twilio_auth_token text,
  twilio_from text,
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table bh_tenant_sms enable row level security;
drop policy if exists bh_app_key_all on bh_tenant_sms;
create policy bh_app_key_all on bh_tenant_sms for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());

-- Per-user dashboard appearance (accent + background), scoped owner|admin.
create table if not exists bh_user_prefs (
  scope       text not null,
  email       text not null,
  accent      text not null default 'teal',
  background  text not null default 'mint',
  updated_at  timestamptz not null default now(),
  primary key (scope, email)
);
alter table bh_user_prefs enable row level security;
drop policy if exists bh_app_key_all on bh_user_prefs;
create policy bh_app_key_all on bh_user_prefs for all to anon, authenticated
  using (bh_check_key()) with check (bh_check_key());
