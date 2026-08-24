#!/usr/bin/env node
// Slotter post-deploy verifier. Hits the live readiness probe and reports whether the app
// booted correctly and can reach its database.
//
//   npm run verify -- https://your-app.example.com
//   (or set NEXT_PUBLIC_BASE_URL and run `npm run verify`)
//
// Exit code is non-zero if the app is unreachable, misconfigured, or the DB is down —
// so it's safe to use as a deploy gate in CI.
//
// No dependencies — plain Node (18+, global fetch).

const base = (process.argv[2] || process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
if (!base) {
  console.error("Usage: npm run verify -- <base-url>   (e.g. https://your-app.example.com)");
  process.exit(2);
}

const url = `${base}/api/health`;
console.log(`\nVerifying ${url} ...\n`);

try {
  const res = await fetch(url, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    console.error(`✗ ${res.status} redirect. This deployment is behind auth/protection (e.g. Vercel preview\n  protection). Test the public production URL, or add a protection-bypass token.`);
    process.exit(1);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!res.ok || !body) {
    console.error(`✗ ${res.status} — unexpected response:\n${text.slice(0, 400)}`);
    process.exit(1);
  }

  const line = (icon, k, v) => console.log(`  ${icon}  ${k.padEnd(9)} ${v}`);
  line(body.ok ? "✓" : "✗", "ok", String(body.ok));
  line("·", "mode", body.mode);          // demo | prod
  line("·", "edition", body.edition);    // agency | market
  line(body.db === "up" ? "✓" : "✗", "db", body.db);

  const healthy = body.ok === true && body.db === "up";
  console.log(`\n${healthy ? "✓ App is live and the database is reachable." : "✗ App responded but is not healthy — check env vars and the Supabase connection."}\n`);
  if (body.mode === "demo") console.log("Note: mode=demo — no real email/payments. Set APP_MODE=prod (and the prod env vars) when you're ready to go live.\n");
  process.exit(healthy ? 0 : 1);
} catch (e) {
  console.error(`✗ Could not reach ${url}\n  ${e.message}\n  Is the URL right and the app deployed?`);
  process.exit(1);
}
