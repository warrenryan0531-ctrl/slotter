#!/usr/bin/env node
// Slotter setup preflight. Validates your environment BEFORE you deploy and catches the
// mistakes that are easy to make and annoying to debug. Safe to run anytime.
//
//   npm run setup:check
//
// It reads .env.local (if present) merged over the real process environment, figures out
// what you're trying to run (APP_MODE + SLOTTER_EDITION + which integrations you've started
// wiring), and prints a ✓ / ⚠ / ✗ checklist. Exit code is non-zero if anything is broken.
//
// No dependencies — plain Node (18+).

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// --- tiny .env parser (no dependency on dotenv) ---
function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvFile(join(ROOT, ".env.local"));
const env = { ...fileEnv, ...process.env }; // real env wins (matches how the app resolves)

const PLACEHOLDERS = [
  "change-me", "changeme", "your-", "YOUR-", "xxxx", "replace", "REPLACE",
  "admin@slotter.local", "slotter.local", "sk_live_...", "price_...", "whsec_...",
  "re_xxxxxxxx", "ACxxxx",
];
const isPlaceholder = (v) => !v || PLACEHOLDERS.some((p) => v.includes(p));
const set = (k) => env[k] !== undefined && env[k] !== "";
const real = (k) => set(k) && !isPlaceholder(env[k]);

let errors = 0, warns = 0;
const results = [];
const ok = (m) => results.push(["✓", m]);
const warn = (m) => { warns++; results.push(["⚠", m]); };
const err = (m) => { errors++; results.push(["✗", m]); };

const MODE = (env.APP_MODE || "demo").toLowerCase();
const EDITION = (env.SLOTTER_EDITION || "agency").toLowerCase();

console.log(`\nSlotter preflight — APP_MODE=${MODE} · SLOTTER_EDITION=${EDITION}\n`);

if (!["demo", "prod"].includes(MODE)) err(`APP_MODE must be "demo" or "prod" (got "${MODE}")`);
if (!["agency", "market"].includes(EDITION)) warn(`SLOTTER_EDITION should be "agency" or "market" (got "${EDITION}"); defaulting to agency`);

// --- always required ---
for (const k of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "BH_API_KEY", "APP_SECRET"]) {
  if (real(k)) ok(`${k} is set`);
  else err(`${k} is required (and must not be a placeholder). See .env.example.`);
}
if (real("APP_SECRET") && env.APP_SECRET.length < 32) warn("APP_SECRET is shorter than 32 chars — use `openssl rand -hex 32`. Changing it later invalidates stored OAuth tokens.");
if (real("BH_API_KEY")) warn("Reminder: BH_API_KEY must EXACTLY equal the api_key row in the bh_secrets table (set by db/schema.sql). If they differ, every DB call is rejected.");

if (real("NEXT_PUBLIC_BASE_URL")) {
  ok("NEXT_PUBLIC_BASE_URL is set");
  if (MODE === "prod" && env.NEXT_PUBLIC_BASE_URL.includes("localhost")) err("NEXT_PUBLIC_BASE_URL is localhost but APP_MODE=prod — set it to your real public URL (emails, embeds and OAuth redirects use it).");
} else warn("NEXT_PUBLIC_BASE_URL not set — defaults to http://localhost:3000. Set your real URL before deploying.");

if (!real("ADMIN_EMAILS")) warn("ADMIN_EMAILS is empty — no one can reach the /admin console. Set at least one email (comma-separated).");

// --- prod email ---
if (MODE === "prod") {
  if (real("RESEND_API_KEY")) ok("RESEND_API_KEY is set"); else err("APP_MODE=prod requires RESEND_API_KEY (real email).");
  if (set("MAIL_FROM") && !isPlaceholder(env.MAIL_FROM)) {
    const bare = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(env.MAIL_FROM.trim());
    if (bare) ok("MAIL_FROM is a bare email address");
    else err(`MAIL_FROM must be a BARE email like "bookings@yourdomain.com" — NOT "Name <bookings@...>". The app adds the display name itself; a wrapped value produces an invalid From and Resend rejects the send (HTTP 500 on booking).`);
  } else err("APP_MODE=prod requires MAIL_FROM (a verified bare address on your Resend domain).");
} else {
  ok("Demo mode — no email/Resend needed (confirmations land in the app, nothing is sent).");
}

// --- calendar (optional, paired) ---
const g = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"];
if (g.some((k) => real(k))) {
  if (g.every((k) => real(k))) {
    ok("Google Calendar OAuth is configured");
    warn("Verify the Google OAuth redirect URI is EXACTLY  <NEXT_PUBLIC_BASE_URL>/api/calendar/callback?provider=google  (include the ?provider=google query — Google accepts it and the app requires it).");
  } else err("Google Calendar needs BOTH GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.");
}
const ms = ["MS_OAUTH_CLIENT_ID", "MS_OAUTH_CLIENT_SECRET"];
if (ms.some((k) => real(k))) {
  if (ms.every((k) => real(k))) ok("Microsoft/Outlook OAuth is configured");
  else err("Microsoft calendar needs BOTH MS_OAUTH_CLIENT_ID and MS_OAUTH_CLIENT_SECRET.");
}
if (!g.some((k) => real(k)) && !ms.some((k) => real(k))) ok("Calendar sync: none configured (fine — it's optional; demo mode simulates it).");

// --- SMS (optional, all-or-nothing) ---
const tw = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"];
if (tw.some((k) => real(k))) {
  if (tw.every((k) => real(k))) ok("Twilio SMS is configured"); else err(`Twilio needs ALL of: ${tw.join(", ")}. Otherwise SMS stays off.`);
} else ok("SMS: none configured (fine — optional; demo texts land in /demo/outbox).");

// --- market billing (optional) ---
if ((env.SLOTTER_BILLING || "").toLowerCase() === "stripe") {
  if (EDITION !== "market") warn("SLOTTER_BILLING=stripe only does anything in the market edition.");
  for (const k of ["STRIPE_PLATFORM_SECRET_KEY", "STRIPE_PRICE_ID", "STRIPE_BILLING_WEBHOOK_SECRET"]) {
    if (real(k)) ok(`${k} is set`); else err(`SLOTTER_BILLING=stripe requires ${k}. Webhook endpoint: <BASE>/api/billing/webhook`);
  }
}

// --- Vercel deployment reminders (can't verify from here, but easy to get wrong) ---
if (MODE === "prod") {
  warn("On Vercel: NEXT_PUBLIC_* vars must be NON-sensitive (plain/config) so they inline at build time — sensitive visibility is rejected for them on Production/Preview.");
  warn("On Vercel: a Sensitive env var cannot target the Development environment — scope secrets to Production (+Preview) only.");
}

// --- print ---
for (const [icon, msg] of results) console.log(`  ${icon}  ${msg}`);
console.log(`\n${errors ? "✗" : "✓"} ${errors} error(s), ${warns} warning(s).`);
if (errors) {
  console.log("Fix the ✗ items above, then re-run `npm run setup:check`.\n");
  process.exit(1);
}
console.log("Environment looks good. Next: deploy, then `npm run verify -- <your-url>`.\n");
