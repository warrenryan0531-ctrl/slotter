# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.1] — 2026-08-27

Hardening pass on the Phase 1 features (from the adversarial reviews' follow-up backlog).

### Security / Reliability

- **B3 — durable pre-charge marker closes the >24h double-charge edge.** A no-show fee charge now
  sets `bh_bookings.fee_charge_pending` *before* calling Stripe and clears it only on confirmed
  success. Any retry with the flag still set must reconcile with Stripe (search for a prior
  succeeded PaymentIntent) before it may create a new one, and refuses if it cannot — so a charge
  can never be duplicated even when the Stripe idempotency key has expired *and* search is
  momentarily unavailable. The atomic claim also serves as a concurrency lock against simultaneous
  clicks. A genuine failure remains safely retryable. (migration 014)
- **B5 — orphaned intake-file cleanup sweep.** Every minted upload URL is tracked in
  `bh_intake_uploads`; the reminders cron GC's tracked uploads older than 24h that no booking
  references, deleting the storage object. Files that got attached to a booking are kept. Closes the
  abandoned-upload storage leak. (migration 014; adds an `intake` bucket delete policy for the
  server role.)
- **B5 — per-tenant upload rate limit.** `/api/intake/upload-url` now also budgets per tenant slug
  (on top of per-IP), bounding abuse aimed at a single tenant from many IPs.

## [2.3.0] — 2026-08-27

The competitive-gap release ("Phase 1", B1–B5): five features closing the highest-impact gaps
against Calendly / Cal.com / Square Appointments, each shipped with unit tests, an adversarial
code review, and a live end-to-end verification.

### Added

- **B1 · Auto video-meeting links** — a service can be located "Video call": every confirmed
  booking mints a real **Google Meet** or **Microsoft Teams** join link through the owner's
  connected calendar (`conferenceData.createRequest` / `isOnlineMeeting`), stored on the booking
  (`meeting_url`) and surfaced everywhere — confirmation email (Join button), `.ics`
  `LOCATION`/description, reminders, and SMS. Demo mode mints a stub link.
- **B1 · Zoom as a first-class provider** — owners can Connect Zoom (Availability page; OAuth,
  AES-256-GCM-encrypted tokens in `bh_meeting_connections`). With Zoom connected, video bookings
  create a **real Zoom meeting** (join link everywhere the Meet/Teams link goes), **retime it** on
  reschedule (same link), and **delete it** on cancellation — preferred over the calendar-minted
  link when both are available. Requires `ZOOM_CLIENT_ID`/`ZOOM_CLIENT_SECRET` (see
  `.env.example`); without them the Zoom section simply doesn't render.
- **B2 · Automatic review requests** — post-visit "How was your visit?" asks on autopilot.
  Settings → "Ask for reviews automatically": toggle, delay (1h–3d), your review link (e.g. a
  Google review URL), channel (email / text / both, with email as guaranteed fallback). Runs off
  the reminders cron with the same atomic claim idempotency (`bh_claim_reminder(id,'review')`) —
  exactly one branded ask per completed booking; cancellations, and no-shows marked before the
  send time, are skipped. A bounded selection window prevents enabling the feature from blasting
  historical bookings.
- **B3 · No-show fees (card-on-file)** — a service can require a card to hold the booking. The
  customer vaults a card at booking via a Stripe **SetupIntent** on the tenant's own Stripe
  account (no charge, no PCI exposure — Stripe Elements only). If the owner marks a no-show, a
  "Charge fee" button charges the fee **once**, off-session, guarded three ways (permanent
  `fee_charged_cents` marker, Stripe idempotency key, and a reconciliation search that survives
  key expiry). Flat or percent-of-price fees. **Charging is deliberately owner-initiated only —
  there is no automatic charging in this release, by explicit design decision.** The amount
  disclosed to the customer at booking is snapshotted (`fee_quote_cents`) and is the only amount
  ever charged; on-time cancellations are never chargeable.
- **B4 · Reports & CSV export** — a new Reports dashboard tab: date-range presets (7/30/90d) and
  custom ranges, stat cards (booked, revenue collected, no-show rate, cancellations),
  bookings-per-day and revenue-per-day charts, top-services and per-staff tables — all bucketed in
  the tenant's timezone. "Download CSV" exports the range's bookings, Excel-clean (UTF-8 BOM,
  RFC-4180 escaping, **formula-injection neutralized**).
- **B5 · File upload on intake** — intake questions can be type "File upload (photo / PDF)". The
  customer uploads at booking straight to a **private** Supabase Storage bucket via a scoped
  signed URL (10MB cap, image/PDF only, enforced server-side *and* by the bucket); the owner gets
  a short-lived signed download link on the booking. Tenant isolation verified adversarially —
  object keys are `<slug>/<uuid>/<sanitized-name>` and downloads are session-gated to the owner's
  own slug prefix.
- **No-login demo** — `GET /demo` provisions/reseeds a pristine sample barbershop ("Coastal Cuts")
  with a fresh day of bookings and drops the visitor straight into the owner dashboard as a
  signed-in owner. Self-heals on every visit; scoped to the hardcoded sample tenant. Ideal for
  sales walkthroughs.

### Fixed

- **Cross-tenant cron selection (latent, important)** — `bh_due_reminders` ran unscoped inside a
  per-tenant loop, so reminders (and the new review asks) could claim and send another tenant's
  bookings under the wrong brand. Both selector RPCs are now tenant-scoped
  (`p_tenant_id`) with a defensive tenant re-check in the cron. Multi-tenant hubs should apply
  migration 010 promptly.
- **HTML injection in notification emails** — customer-supplied values (name, intake answers,
  address) are now HTML-escaped before interpolation into owner/customer email bodies.

### Security

- Tenant slug charset is now enforced at the database (`^[a-z0-9-]+$`), locking the invariant the
  intake-file isolation depends on; login demo-hint credentials render only in demo mode; intake
  upload endpoint rate-limited; CSV export neutralizes formula injection.

### Migrations

- `009_video_meetings.sql`, `010_review_requests.sql` (**required** — replaces
  `bh_due_reminders(text,numeric)` with a tenant-scoped 3-arg version), `011_no_show_fees.sql`,
  `012_intake_files.sql` (+ private `intake` storage bucket per its header comments),
  `013_zoom_meetings.sql`.

## [2.2.0] — 2026-08-24

Design + theming release, plus per-tenant SMS numbers and per-tenant booking-page branding.

### Added

- **Personalized dashboard themes.** Each user picks their own **accent** (15 colors — menu pills, buttons, links, glows, focus) and **background** (8 canvas tints) under Settings → Appearance, with a live swatch picker that recolors the whole dashboard instantly and saves per user. Preferences are **scoped per view** (`bh_user_prefs`, keyed by owner|admin + email), so the agency admin and each business owner can each theme their own dashboard independently. Implemented with a runtime CSS-variable brand scale (`data-accent` / `data-bg` on the shell) and `color-mix` glows, so one attribute swap re-themes every accent-derived surface at once.

### Changed

- **Dashboard redesign — "premium light".** A full visual overhaul of the owner dashboard: a left sidebar with iconned nav and an emerald active-pill (collapsing to a clean mobile top bar), a "Welcome back" greeting with at-a-glance stat cards (booked today, awaiting approval, upcoming, next 7 days), soft rounded cards with real depth on a mint canvas, the Geist typeface (replacing the system Arial stack), and a single unified emerald accent in place of the old mismatched gray/blue/indigo buttons. New reusable component classes (`.card`, `.btn`, `.input`, `.badge`) in `globals.css`, a shared `DashShell` sidebar component, and refined focus rings — all light-locked and WCAG-contrast-safe. Adds the self-hosted `geist` font package (no runtime network needed).

### Added

- **Per-tenant booking-page color** — each business's public booking page (`/b/<slug>` and the embed) now renders in the business's own brand color. Owners pick it in Settings → Appearance ("what customers see") from 15 presets or a custom hex; the `add-booking-tool` provisioning flow can set it per client. Drives every button, selected day, and time slot in the booking flow via `branding.color`.
- **Per-business SMS numbers** — a business can now send texts from its *own* purchased Twilio number instead of the shared deployment-wide one. Store the business's Twilio credentials in the new `bh_tenant_sms` table (app-key RLS, same as every other secret-bearing table) and its bookings send from that number, with its own A2P registration, reputation, and STOP opt-out list — fully isolated from other businesses on the hub. Businesses with no row fall back to the deployment-wide `TWILIO_*` number. No code changes to switch a client over — just data. (`docs/SMS.md`)

### Changed

- **SMS sender resolution** — the Twilio adapter now resolves the sending number per-tenant at send time (own number → deployment fallback), and the booking page only shows the text opt-in when *that* tenant can actually send. Admins are warned in `.env.example`, `AGENTS.md`, and `docs/SMS.md` that the env-level `TWILIO_*` vars are a single shared sender across all hosted businesses, with per-business numbers as the multi-tenant-correct alternative.

## [2.1.0] — 2026-08-23

Launch-readiness hardening pass.

### Added

- **Email verification on signup** — the market edition now creates a business only *after* the owner confirms their email code, closing the email-squatting hole.
- **Integration test harness** — mocked-provider tests prove the Google, Outlook, Twilio, and Stripe adapters against each provider's documented API shapes (request format, response parsing, own-event filtering, token refresh, refund idempotency). 35 automated tests total.
- **Observability** — a `/api/health` readiness probe (reports DB status), structured error capture with an optional webhook alert (`ERROR_WEBHOOK_URL`, Slack-compatible), and a React error boundary. Money-critical paths (refund failure, Stripe webhooks) alert loudly.
- **Calendar reconciliation sweep** — the cron garbage-collects external calendar events orphaned by a failed delete, closing the last sync durability gap.
- **Market-edition billing meter** — a plan table, an upgrade flow (instant in demo, real Stripe subscription Checkout in prod), a subscription webhook, and a Billing dashboard tab.

### Fixed

- Accessibility: resolved a contrast issue on the signup form; the new pages (market landing, signup, onboarding, billing, services editor, calendar sync) pass axe-core WCAG 2 A/AA at desktop and mobile widths.

## [2.0.0] — 2026-08-23

Major feature release — the capabilities that put Slotter on par with commercial schedulers.

### Added

- **Two-way calendar sync** — connect Google Calendar or Outlook/Microsoft 365: the owner's busy times block slots, and every booking is written back to their calendar. Demo adapter needs no accounts; OAuth tokens are AES-256-GCM encrypted at rest. (`docs/CALENDAR-SYNC.md`)
- **SMS** — Twilio-backed text confirmations and reminders (demo lands in the outbox), consent-gated.
- **No-SQL provisioning** — owners create/edit/delete services (all modes, pricing, deposits, group capacity, intake questions) and manage staff from the dashboard; admins create businesses from `/admin`. All via guarded RPCs.
- **Booking depth** — pay-in-full (not just deposits), automatic refunds on eligible cancellation (atomic + idempotent), no-show marking, and class waitlists with atomic auto-promotion of the next person when a seat frees.
- **Two editions from one codebase** — `SLOTTER_EDITION=agency` (white-label multi-tenant hub) or `market` (self-serve signup + onboarding wizard + marketing landing). Edition is enforced in route handlers, not just the UI. (`docs/EDITIONS.md`)

### Security

- Third-party OAuth tokens are encrypted with `APP_SECRET` before storage (`lib/crypto.ts`); the database never holds usable tokens.
- Calendar sync filters out Slotter's own events when reading busy times, so it can't block its own slots; freebusy fails safe to the last cached set rather than exposing the owner's real commitments.

## [1.0.0] — 2026-08-23

First public open-source release.

### Added

- **Four booking modes:** instant appointments (V1), request-to-book & callbacks (V2), paid deposits via the tenant's own Stripe (V3), and group classes with capacity and live seats-remaining (V4).
- **Three embed methods:** auto-resizing `<script>` widget, plain `<iframe>`, and a hosted booking-page link.
- **Multi-tenant:** one deployment serves many businesses, each with its own slug, branding, staff, services, and availability.
- **Owner dashboard:** passwordless email-code login; manage availability, day-off blocks, services, group class sessions, branding, reminders, and approve/decline requests.
- **Universal calendar delivery:** standards-compliant `.ics` invites plus a per-tenant subscribable feed — no OAuth.
- **Database-enforced correctness:** Postgres exclusion constraint prevents double-booking; class capacity is enforced inside guarded functions.
- **Timezone/DST-correct slot engine** as pure, unit-tested functions.
- **Idempotent email reminders** on a tenant-configurable cadence via a single cron endpoint.
- **Demo mode:** fully functional with zero external services (built-in test checkout and outbox).
- **Docs:** README, `docs/BOOKING-MODES.md`, `docs/HOSTING-GUIDE.md`, `docs/PAYMENTS.md`, `CONTRIBUTING.md`.
- **Repo furniture:** MIT license, CI workflow, issue/PR templates, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- **Full schema (`db/schema.sql`) and demo seed (`db/seed.sql`)** covering all four modes.

[1.0.0]: https://github.com/your-org/slotter/releases/tag/v1.0.0
