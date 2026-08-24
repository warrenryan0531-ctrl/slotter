const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;
const BASE = process.argv[2] || "http://localhost:3114";
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const WIDTHS = [{ w: 1440, h: 900, tag: "desktop" }, { w: 390, h: 844, tag: "mobile" }];
const PUBLIC = ["/", "/signup"];
const AUTHED = ["/dashboard/services", "/dashboard/availability", "/dashboard/onboarding", "/dashboard/billing"];

async function scan(page, route, tag, findings) {
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const v of res.violations)
    findings.push({ route, width: tag, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.[0] });
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const findings = [];
  for (const r of PUBLIC) for (const v of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h } });
    const page = await ctx.newPage();
    await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 60000 });
    await scan(page, r, v.tag, findings);
    await ctx.close();
  }
  // authenticated dashboard pass (one desktop context, logged in)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  await page.getByTestId("login-email").fill("owner@coastalshine.demo");
  await page.getByTestId("login-send").click();
  await page.getByTestId("login-code").waitFor({ timeout: 8000 });
  await page.getByTestId("login-code").fill("123456");
  await page.getByTestId("login-verify").click();
  await page.waitForLoadState("networkidle");
  for (const r of AUTHED) {
    await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 60000 });
    await scan(page, r, "desktop-authed", findings);
  }
  await ctx.close();
  await browser.close();
  console.log(JSON.stringify(findings, null, 2));
})();
