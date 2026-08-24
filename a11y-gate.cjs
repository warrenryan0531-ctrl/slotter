const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const BASE = process.argv[2] || "http://localhost:3100";
// Customer-facing surfaces (the widget lives on client sites we sell a11y on).
const ROUTES = ["/b/coastal-shine", "/b/rivera-law", "/b/riverside-yoga", "/embed/coastal-shine"];
const WIDTHS = [{ w: 1440, h: 900, tag: "desktop" }, { w: 390, h: 844, tag: "mobile" }];
const EXE = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true });
  const findings = [];
  for (const r of ROUTES) for (const v of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h } });
    const page = await ctx.newPage();
    await page.goto(BASE + r, { waitUntil: "networkidle", timeout: 60000 });
    // advance one step into the flow so the service/slot UI is also scanned
    await page.locator('[data-testid^="service-"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    for (const vio of res.violations)
      findings.push({ route: r, width: v.tag, id: vio.id, impact: vio.impact, help: vio.help, nodes: vio.nodes.length, target: vio.nodes[0]?.target?.[0] });
    await ctx.close();
  }
  await browser.close();
  console.log(JSON.stringify(findings, null, 2));
})();
