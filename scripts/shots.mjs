// One-off screenshot capture for the README. Not shipped in the package.
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const OUT = "/root/slotter/docs/screenshots";
const CH = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: CH });

async function shot(page, name, full = false) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("saved", name);
}

// advance the booking flow: service -> (staff) -> time (slot grid visible)
async function toSlots(page) {
  await page.locator('[data-testid^="service-"]').first().click();
  await sleep(400);
  const staff = page.locator('[data-testid^="staff-"]');
  if (await staff.count()) { await staff.first().click(); await sleep(300); }
  await page.waitForSelector('[data-testid="slot-grid"]', { timeout: 12000 });
  await sleep(700);
}

// ---------- desktop 1280 ----------
const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const d = await ctxD.newPage();

await d.goto(`${BASE}/`, { waitUntil: "networkidle" }); await sleep(400);
await shot(d, "01-landing", true);

await d.goto(`${BASE}/b/coastal-shine`, { waitUntil: "networkidle" }); await sleep(500);
await shot(d, "02-booking-services");

await d.goto(`${BASE}/b/coastal-shine`, { waitUntil: "networkidle" }); await sleep(400);
try { await toSlots(d); await shot(d, "03-booking-slots"); }
catch (e) { console.log("slots skipped:", e.message); }

await d.goto(`${BASE}/b/riverside-yoga`, { waitUntil: "networkidle" }); await sleep(500);
try { await d.locator('[data-testid^="service-"]').first().click(); await sleep(900); } catch {}
await shot(d, "04-group-classes");

// login once, then capture dashboard tabs
await d.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await d.fill('[data-testid="login-email"]', "owner@coastalshine.demo");
await d.click('[data-testid="login-send"]');
await d.waitForSelector('[data-testid="login-code"]', { timeout: 8000 });
await d.fill('[data-testid="login-code"]', "123456");
await d.click('[data-testid="login-verify"]');
await d.waitForLoadState("networkidle"); await sleep(1000);

// Services tab — shows the mode badges (auto-confirm / approve-each / group / deposit)
await d.goto(`${BASE}/dashboard/services`, { waitUntil: "networkidle" }); await sleep(700);
await shot(d, "05-dashboard-services", true);

// Availability tab — weekly hours editor
await d.goto(`${BASE}/dashboard/availability`, { waitUntil: "networkidle" }); await sleep(700);
await shot(d, "06-dashboard-availability", true);

// Embed / add-to-site tab — the three embed options
await d.goto(`${BASE}/dashboard/embed`, { waitUntil: "networkidle" }); await sleep(700);
await shot(d, "07-embed-options", true);
await ctxD.close();

// ---------- mobile 390 (for the booking flow) ----------
const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true });
const m = await ctxM.newPage();
await m.goto(`${BASE}/b/coastal-shine`, { waitUntil: "networkidle" }); await sleep(500);
await shot(m, "08-mobile-services");
try { await toSlots(m); await shot(m, "09-mobile-slots"); }
catch (e) { console.log("mobile slots skipped:", e.message); }
await ctxM.close();

await browser.close();
console.log("done");
