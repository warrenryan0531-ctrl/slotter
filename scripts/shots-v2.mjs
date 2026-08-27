// Refresh/add screenshots for v2 features. Server must be running in MARKET edition.
import { chromium } from "playwright";
const BASE = process.env.E2E_BASE_URL || "http://localhost:3120";
const OUT = "/root/slotter/docs/screenshots";
const CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: CH });

async function shot(page, name, full = true) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full }); console.log("saved", name); }

// market landing (desktop)
const d = await (await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })).newPage();
await d.goto(`${BASE}/`, { waitUntil: "networkidle" }); await sleep(400);
await shot(d, "10-market-landing");

// authed dashboard: services (with editor) + availability (with calendar sync)
await d.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await d.getByTestId("login-email").fill("owner@coastalshine.demo");
await d.getByTestId("login-send").click();
await d.getByTestId("login-code").waitFor({ timeout: 8000 });
await d.getByTestId("login-code").fill("123456");
await d.getByTestId("login-verify").click();
await d.waitForLoadState("networkidle"); await sleep(900);

await d.goto(`${BASE}/dashboard/services`, { waitUntil: "networkidle" }); await sleep(700);
await shot(d, "05-dashboard-services");

await d.goto(`${BASE}/dashboard/availability`, { waitUntil: "networkidle" }); await sleep(700);
await shot(d, "06-dashboard-availability");

await b.close();
console.log("done");
