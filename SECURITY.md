# Security Policy

## Reporting a vulnerability

If you find a security issue in Slotter, please **do not open a public issue**. Instead, report it privately so it can be fixed before it's disclosed:

- Use GitHub's **[Report a vulnerability](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)** (Security → Advisories → Report a vulnerability) on this repository, or
- Email the maintainer listed on the repository profile.

Please include enough detail to reproduce: affected version/commit, `APP_MODE`, and steps or a proof of concept. We'll acknowledge your report, work on a fix, and credit you (if you'd like) when it ships.

## Scope

Most relevant to Slotter's security posture:

- The app-key auth model (anon key + `x-bh-key` header + RLS + guarded `SECURITY DEFINER` functions) — see the **Security model** section of the README.
- The reminder cron endpoint (`/api/cron/reminders`) and its `CRON_SECRET`.
- The Stripe webhook endpoint (`/api/webhooks/stripe`) and per-tenant signature verification.
- Tenant isolation (one deployment serving many businesses).

## Deployment hardening

Slotter is self-hosted, so some of your security depends on how you run it. At minimum:

- Set a strong, unique `BH_API_KEY` and `APP_SECRET` — never the demo placeholders.
- Serve only over HTTPS.
- Keep `bh_secrets` and `bh_tenant_payments` locked down (RLS is enabled by the schema; don't relax it).
- Give each tenant their own Stripe keys and webhook secret; never share one across tenants.

## Supported versions

This is an actively developed open-source project; security fixes target the latest `main`. Pin a commit or release you've reviewed if you need stability.
