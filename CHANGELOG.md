# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
