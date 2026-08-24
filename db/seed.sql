-- Slotter — demo seed (optional).
-- Run this AFTER schema.sql against a fresh database to get three working demo businesses
-- that exercise all four booking modes. Safe to re-run: it clears the demo rows first.
--
-- Demo owner logins (APP_MODE=demo, code is always 123456):
--   owner@coastalshine.demo   — Coastal Shine Mobile Detailing
--   maria@riveralaw.demo      — Rivera Law
--   owner@riversideyoga.demo  — Riverside Yoga Studio
--
-- The four versions demonstrated:
--   V1 instant appointment    — Coastal Shine "Express Wash" / "Full Detail" (on-site, address)
--   V2 request / callback      — Coastal Shine "Ceramic Coating consult" (request-to-book)  +  Rivera Law phone consults
--   V3 paid deposit            — Coastal Shine "Ceramic Coating" ($50 deposit before the slot is held)
--   V4 group / event           — Riverside Yoga classes (seats-remaining, capacity per class)

begin;

-- ---------- clean slate for the three demo tenants (id cascade handles children) ----------
delete from bh_tenants where slug in ('coastal-shine', 'rivera-law', 'riverside-yoga');

-- ============================================================
-- TENANT 1 — Coastal Shine Mobile Detailing  (V1 + V2 + V3)
-- ============================================================
insert into bh_tenants (id, slug, name, tz, ics_token, branding) values
  ('11111111-1111-4111-8111-111111111111', 'coastal-shine', 'Coastal Shine Mobile Detailing',
   'America/New_York', 'ics-coastal-shine-demo-token',
   '{"accent":"#4f46e5","tagline":"We come to you."}');

-- two staff (owner + one tech)
insert into bh_staff (id, tenant_id, name, email, is_owner) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Dana (Owner)', 'owner@coastalshine.demo', true),
  ('a2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Marcus', 'marcus@coastalshine.demo', false);

-- Mon–Fri 8:00–17:00 for both, Sat 9:00–13:00 for the owner
insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
select s.id, wd, 480, 1020
from bh_staff s, generate_series(1,5) wd
where s.tenant_id = '11111111-1111-4111-8111-111111111111';
insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
values ('a1111111-1111-4111-8111-111111111111', 6, 540, 780);

-- services
insert into bh_services (id, tenant_id, name, description, duration_min, buffer_before_min, buffer_after_min,
                         price_cents, kind, location_mode, sort, booking_mode, deposit_cents, requires_payment) values
  -- V1 instant, on-site
  ('c0000001-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
   'Express Wash', 'Exterior hand wash + wheels. We come to your driveway.', 45, 15, 15,
   6000, 'onsite', 'address', 1, 'instant', null, false),
  ('c0000002-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
   'Full Detail', 'Interior + exterior, clay bar, wax. Half-day job.', 240, 15, 30,
   28000, 'onsite', 'address', 2, 'instant', null, false),
  -- V3 paid deposit — deposit held before the slot is confirmed
  ('cccccc04-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111',
   'Ceramic Coating', 'Multi-year paint protection. $50 deposit reserves your slot, applied to the total.', 300, 30, 30,
   90000, 'onsite', 'address', 3, 'instant', 5000, true);

-- staff ↔ service (owner does everything; Marcus does the two washes)
insert into bh_service_staff (service_id, staff_id) values
  ('c0000001-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111'),
  ('c0000001-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222'),
  ('c0000002-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111'),
  ('c0000002-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222'),
  ('cccccc04-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111');

-- one intake question on the Full Detail
insert into bh_intake_questions (service_id, label, type, required, sort) values
  ('c0000002-1111-4111-8111-111111111111', 'Vehicle year / make / model', 'text', true, 1),
  ('c0000002-1111-4111-8111-111111111111', 'Anything we should know about the condition?', 'textarea', false, 2);

-- ============================================================
-- TENANT 2 — Rivera Law  (V2 phone consultations)
-- ============================================================
insert into bh_tenants (id, slug, name, tz, ics_token, branding) values
  ('22222222-2222-4222-8222-222222222222', 'rivera-law', 'Rivera Law', 'America/New_York',
   'ics-rivera-law-demo-token', '{"accent":"#0f766e","tagline":"Straightforward counsel."}');

insert into bh_staff (id, tenant_id, name, email, is_owner) values
  ('b1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'Maria Rivera, Esq.', 'maria@riveralaw.demo', true);

-- Mon–Fri 9:00–16:00
insert into bh_availability_rules (staff_id, weekday, start_min, end_min)
select 'b1111111-1111-4111-8111-111111111111', wd, 540, 960 from generate_series(1,5) wd;

insert into bh_services (id, tenant_id, name, description, duration_min, buffer_before_min, buffer_after_min,
                         price_cents, kind, location_mode, sort, booking_mode) values
  -- V2 — free intro call, booked straight onto the calendar
  ('c0000021-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   'Free 15-min intro call', 'A quick call to see if we are a fit. She calls you.', 15, 0, 15,
   0, 'call', 'phone', 1, 'instant'),
  -- V2 request-to-book — she screens paid consults before confirming
  ('c0000022-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222',
   'Paid 60-min consultation', 'In-depth review of your matter. Requested, then confirmed once she reviews your notes.', 60, 0, 15,
   25000, 'call', 'phone', 2, 'request');

insert into bh_service_staff (service_id, staff_id) values
  ('c0000021-2222-4222-8222-222222222222', 'b1111111-1111-4111-8111-111111111111'),
  ('c0000022-2222-4222-8222-222222222222', 'b1111111-1111-4111-8111-111111111111');

insert into bh_intake_questions (service_id, label, type, required, sort) values
  ('c0000022-2222-4222-8222-222222222222', 'Briefly, what is the matter about?', 'textarea', true, 1);

-- ============================================================
-- TENANT 3 — Riverside Yoga Studio  (V4 group classes)
-- ============================================================
insert into bh_tenants (id, slug, name, tz, ics_token, branding) values
  ('33333333-3333-4333-8333-333333333333', 'riverside-yoga', 'Riverside Yoga Studio', 'America/New_York',
   'ics-riverside-yoga-demo-token', '{"accent":"#b45309","tagline":"Breathe. Move. Rest."}');

insert into bh_staff (id, tenant_id, name, email, is_owner) values
  ('d1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'Priya (Owner)', 'owner@riversideyoga.demo', true),
  ('d2222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'Sam', 'sam@riversideyoga.demo', false);

-- group service: capacity handled per-event, is_group = true
insert into bh_services (id, tenant_id, name, description, duration_min, price_cents, kind, location_mode,
                         sort, is_group, capacity) values
  ('c0000031-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333',
   'Vinyasa Flow', 'All-levels 60-minute flow. Reserve one of the mats.', 60, 1800, 'appointment', 'business', 1, true, 12),
  ('c0000032-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333',
   'Gentle / Restorative', 'Slow, prop-supported class. Great for beginners.', 75, 1800, 'appointment', 'business', 2, true, 10);

insert into bh_service_staff (service_id, staff_id) values
  ('c0000031-3333-4333-8333-333333333333', 'd1111111-1111-4111-8111-111111111111'),
  ('c0000031-3333-4333-8333-333333333333', 'd2222222-2222-4222-8222-222222222222'),
  ('c0000032-3333-4333-8333-333333333333', 'd1111111-1111-4111-8111-111111111111');

-- upcoming class instances for the next 14 days (computed from now so the demo always has live classes).
-- Vinyasa: Mon/Wed/Fri 18:00, capacity 12.  Restorative: Tue/Thu 19:00, capacity 10.
insert into bh_events (tenant_id, service_id, staff_id, starts_at, ends_at, capacity)
select '33333333-3333-4333-8333-333333333333', 'c0000031-3333-4333-8333-333333333333',
       'd1111111-1111-4111-8111-111111111111',
       d + time '18:00', d + time '18:00' + interval '60 min', 12
from generate_series(current_date, current_date + 14, interval '1 day') g(d)
where extract(dow from d) in (1,3,5) and d + time '18:00' > now();

insert into bh_events (tenant_id, service_id, staff_id, starts_at, ends_at, capacity)
select '33333333-3333-4333-8333-333333333333', 'c0000032-3333-4333-8333-333333333333',
       'd2222222-2222-4222-8222-222222222222',
       d + time '19:00', d + time '19:00' + interval '75 min', 10
from generate_series(current_date, current_date + 14, interval '1 day') g(d)
where extract(dow from d) in (2,4) and d + time '19:00' > now();

commit;

-- Done. Visit /b/coastal-shine, /b/rivera-law, /b/riverside-yoga — or sign in at /dashboard
-- with one of the demo owner emails above and code 123456.
