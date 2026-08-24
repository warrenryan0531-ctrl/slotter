# Two-way calendar sync (V2 feature)

Slotter reads the owner's real calendar so it never offers a time they're already busy, and it writes every booking onto that calendar automatically. This is the "two-way sync" the big scheduling tools have — and it works in **demo mode with no accounts at all** so you can see it before wiring anything up.

## What it does

- **Reads busy times → blocks slots.** Once a staff member connects a calendar, any event on it removes the overlapping times from the booking page. If the owner drops a dentist appointment on their personal Google calendar, that slot silently disappears from Slotter.
- **Writes bookings → the calendar.** When a booking is confirmed (or rescheduled/cancelled), Slotter creates/updates/removes the matching event on the connected calendar, in addition to sending the customer the usual `.ics` invite.
- **Never blocks its own slots.** Slotter tags the events it creates and filters them out when reading busy times, so its own bookings (and any stale event left by a failed delete) can't wrongly block a slot it has freed.
- **Fails safe.** If Google/Microsoft is briefly unreachable, Slotter falls back to the last known busy set rather than pretending the owner is free — it will never double-book the owner because an API call timed out.

## Try it in demo mode

1. Sign in to the dashboard, go to **Availability → Calendar sync**.
2. Click **Connect demo calendar**. A fake calendar (busy 15:00–16:00 UTC each day) is attached instantly.
3. Open the booking page — the times overlapping that window are gone. Disconnect to bring them back.

No Google or Microsoft account needed; the demo adapter stands in for both.

## Production setup

Each staff member connects their own calendar via OAuth. You (the host) create the OAuth apps once; owners then click "Connect" and approve.

### Google

1. In Google Cloud Console, create an **OAuth 2.0 Client ID** (Web application).
2. Authorized redirect URI: `https://YOUR-HOST/api/calendar/callback?provider=google`
3. Enable the **Google Calendar API** for the project.
4. Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the environment.
5. Owners connect via **Availability → Connect Google**.

> Google **app verification** is required before external users can grant long-lived access (unverified apps cap refresh tokens and user counts). Plan for the verification review if you're running this for many businesses. This is a Google-side step you complete once.

### Microsoft (Outlook / Microsoft 365)

1. Register an app in **Microsoft Entra ID** (Azure AD).
2. Redirect URI: `https://YOUR-HOST/api/calendar/callback?provider=microsoft`
3. API permissions (delegated): `Calendars.ReadWrite`, `offline_access`, `User.Read`.
4. Set `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_CLIENT_SECRET`, and `MS_OAUTH_TENANT` (`common` for multi-tenant).
5. Owners connect via **Availability → Connect Outlook**.

### Apple iCloud

Apple has no OAuth calendar API. iCloud users get **one-way** delivery today via the per-tenant subscribable `.ics` feed (already built) — the booking lands on their calendar, but iCloud busy times aren't read back. Two-way iCloud (CalDAV) is on the roadmap.

## How tokens are protected

OAuth access/refresh tokens are **encrypted at the application layer** (AES-256-GCM, keyed by `APP_SECRET`) before they're stored, and `APP_SECRET` never lives in the database. A database dump or the app key alone yields only ciphertext — the tokens can't be used without the deployment's secret. Token refresh happens server-side; tokens never reach the browser.

## Security & reliability notes

- Freebusy is cached briefly (per staff, ~60s) in a durable table to throttle provider APIs and survive serverless restarts.
- Calendar push is best-effort and never blocks a booking: if the push fails, the booking still succeeds and the failure is logged.
- A reconciliation sweep (roadmap) garbage-collects any external events orphaned by a failed delete.
