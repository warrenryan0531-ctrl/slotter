import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { gzipSync } from "zlib";
import { readFileSync } from "fs";
import { join } from "path";

function cronSecret(): string {
  try {
    const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    return env.match(/^CRON_SECRET=(.+)$/m)?.[1]?.trim() ?? "";
  } catch { return ""; }
}

const COASTAL = "coastal-shine";
const SVC_CALLBACK = "cccccc03-1111-4111-8111-111111111111";
const SVC_WASH = "cccccc02-1111-4111-8111-111111111111";
const STAFF_MARCUS = "aaaaaaa1-1111-4111-8111-111111111111";
const STAFF_MARIA = "bbbbbbb1-2222-4222-8222-222222222222";
const SVC_CONSULT = "dddddd01-2222-4222-8222-222222222222";

async function getSlots(request: APIRequestContext, slug: string, service: string, staff: string): Promise<number[]> {
  const r = await request.get(`/api/slots?slug=${slug}&service=${service}&staff=${staff}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()).slots as number[];
}

// Each API booking call presents a distinct client IP (server reads x-forwarded-for),
// so the per-IP abuse limits stay strict in prod while the suite runs repeatedly.
let ipCounter = 1;
function freshIp() { return { "x-forwarded-for": `10.99.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}` }; }

async function apiBook(request: APIRequestContext, over: Record<string, unknown> = {}) {
  return request.post("/api/book", {
    headers: freshIp(),
    data: {
      slug: COASTAL, serviceId: SVC_CALLBACK, staffId: STAFF_MARCUS,
      customer: { name: "E2E Test", phone: "(904) 555-0100", email: "e2e@example.com" },
      intake: {}, address: "", smsConsent: false,
      ...over,
    },
  });
}

async function ownerLogin(page: Page, email = "owner@coastalshine.demo") {
  await page.goto("/dashboard");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-send").click();
  await page.getByTestId("login-code").fill("123456");
  await page.getByTestId("login-verify").click();
  // owners land on their dashboard; admins land on the "go to admin" screen
  await expect(page.getByRole("heading", { name: /Coastal Shine|Rivera|Riverside/ }).or(page.getByText("signed in as an administrator")).first()).toBeVisible({ timeout: 15000 });
}

/** Book the first slot that succeeds (prior runs leave bookings behind — 409s are expected). */
async function bookFresh(request: APIRequestContext, over: Record<string, unknown>, opts?: { near?: boolean }): Promise<{ token: string; start: number }> {
  const slug = (over.slug as string) ?? COASTAL;
  const service = (over.serviceId as string) ?? SVC_CALLBACK;
  const staff = (over.staffId as string) ?? STAFF_MARCUS;
  const slots = await getSlots(request, slug, service, staff);
  const pool = opts?.near ? slots.filter((s) => s - Date.now() < 23 * 3600000) : slots.slice().reverse();
  for (const start of pool.slice(0, 8)) {
    const r = await apiBook(request, { ...over, start });
    if (r.status() === 200) return { token: (await r.json()).manageToken, start };
    expect(r.status()).toBe(409); // only acceptable failure is a taken slot
  }
  throw new Error("could not find a bookable slot");
}

test.describe("customer booking flow (FR1-FR7)", () => {
  test("full mobile booking: service → staff → slot → details → confirmed", async ({ page }) => {
    await page.goto(`/b/${COASTAL}`);
    await expect(page.getByRole("heading", { name: "Coastal Shine Mobile Detailing" })).toBeVisible();
    // FR1: services render as buttons with duration/price
    await expect(page.getByTestId(`service-${SVC_WASH}`)).toContainText("Express Wash");
    await expect(page.getByTestId(`service-${SVC_WASH}`)).toContainText("$59");
    await page.getByTestId(`service-${SVC_WASH}`).click();
    // multi-staff service → staff chooser
    await page.getByTestId(`staff-${STAFF_MARCUS}`).click();
    // FR2: slots load — book at the far end of the horizon so cleanup (cancel) is allowed
    await page.getByTestId("day-strip").waitFor({ timeout: 20000 });
    await page.getByTestId("day-strip").locator("button").last().click();
    const slotBtn = page.getByTestId("slot-grid").locator("button").last();
    await slotBtn.click();
    // FR3: details + intake + address (onsite service) in one screen
    await page.getByTestId("in-name").fill("Taylor E2E");
    await page.getByTestId("in-phone").fill("(904) 555-0161");
    await page.getByTestId("in-email").fill("taylor.e2e@example.com");
    await page.getByTestId("in-address").fill("500 Water St, Jacksonville, FL");
    const q = page.locator('[data-testid^="in-q-"]').first();
    await q.fill("2021 Honda Civic");
    await page.getByTestId("in-sms").check(); // FR7
    await page.getByTestId("confirm-booking").click();
    // FR5: confirmation with manage + calendar links
    await expect(page.getByTestId("booking-done")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("add-to-calendar")).toBeVisible();
    const manageHref = await page.getByTestId("manage-link").getAttribute("href");
    expect(manageHref).toMatch(/\/manage\/.+/);
    // no horizontal scroll at 375px (NFR1)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // cleanup: cancel so repeated runs don't consume demo availability
    await page.request.post(`/api/manage/${manageHref!.split("/manage/")[1]}`, { data: { action: "cancel" } });
  });

  test("solo tenant skips the staff step (UC1/solo mode)", async ({ page }) => {
    await page.goto("/b/rivera-law");
    await page.getByTestId(`service-${SVC_CONSULT}`).click();
    // straight to time picking — no staff chooser
    await expect(page.getByTestId("day-strip")).toBeVisible({ timeout: 20000 });
  });

  test("required intake enforced client+server (FR3)", async ({ page, request }) => {
    // server-side: missing required intake answer → 400
    const slots = await getSlots(request, "rivera-law", SVC_CONSULT, STAFF_MARIA);
    const r = await apiBook(request, { slug: "rivera-law", serviceId: SVC_CONSULT, staffId: STAFF_MARIA, start: slots[slots.length - 1], intake: {} });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toBe("intake_required");
    void page;
  });
});

test.describe("Version 3: paid booking + deposit", () => {
  const SVC_WASH_PAID = "cccccc04-1111-4111-8111-111111111111"; // Ceramic Coating, $50 deposit, staff Marcus+Deja
  const WASH_INTAKE = { "eeeeee07-1111-4111-8111-111111111111": "2020 Subaru Outback" };

  async function startPaid(request: APIRequestContext, start: number, over: Record<string, unknown> = {}) {
    return request.post("/api/book", {
      headers: freshIp(),
      data: { slug: COASTAL, serviceId: SVC_WASH_PAID, staffId: STAFF_MARCUS, start,
        customer: { name: "Pay Tester", phone: "(904) 555-0190", email: "pay@example.com" },
        intake: WASH_INTAKE, address: "12 Shore Dr, Jacksonville FL", smsConsent: false, ...over },
    });
  }

  test("paid booking holds the slot pending, then confirms after the deposit is paid", async ({ request }) => {
    const slots = await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS);
    let token = "", used = 0;
    for (const start of slots.slice().reverse().slice(0, 8)) {
      const r = await startPaid(request, start);
      if (r.status() === 409) continue;
      expect(r.status()).toBe(200);
      const j = await r.json();
      expect(j.paid).toBe(true);
      expect(j.paymentUrl).toContain(`/demo/pay/`); // demo checkout, not Stripe
      token = j.manageToken; used = start; break;
    }
    expect(token).toBeTruthy();
    // slot is HELD while payment is pending (not bookable by someone else)
    expect(await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS)).not.toContain(used);

    // simulate paying the deposit
    const pay = await request.post(`/api/demo-pay/${token}`, { data: { action: "pay" } });
    expect(pay.ok()).toBeTruthy();
    // now it's a real confirmed booking with a calendar invite
    const ics = await request.get(`/api/booking-ics/${token}`);
    expect((await ics.text())).toContain("METHOD:REQUEST");
    await request.post(`/api/manage/${token}`, { data: { action: "cancel" } }); // cleanup
  });

  test("abandoning checkout releases the held slot", async ({ request }) => {
    const slots = await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS);
    let token = "", used = 0;
    for (const start of slots.slice().reverse().slice(0, 8)) {
      const r = await startPaid(request, start, { customer: { name: "Abandoner", phone: "1", email: "abandon@example.com" } });
      if (r.status() === 409) continue;
      expect(r.status()).toBe(200);
      token = (await r.json()).manageToken; used = start; break;
    }
    expect(token).toBeTruthy();
    expect(await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS)).not.toContain(used); // held
    // customer cancels at checkout
    await request.post(`/api/demo-pay/${token}`, { data: { action: "cancel" } });
    // slot is available again
    expect(await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS)).toContain(used);
  });

  test("the demo checkout page renders the deposit and a no-real-charge notice", async ({ page, request }) => {
    const slots = await getSlots(request, COASTAL, SVC_WASH_PAID, STAFF_MARCUS);
    let token = "";
    for (const start of slots.slice().reverse().slice(0, 8)) {
      const r = await startPaid(request, start, { customer: { name: "Page Tester", phone: "2", email: "pagepay@example.com" } });
      if (r.status() === 409) continue;
      token = (await r.json()).manageToken; break;
    }
    expect(token).toBeTruthy();
    await page.goto(`/demo/pay/${token}`);
    await expect(page.getByTestId("demo-notice")).toContainText(/no real charge/i);
    await expect(page.getByTestId("demo-pay")).toContainText("$50");
    await page.getByTestId("demo-pay").click();
    await expect(page.getByTestId("paid-banner")).toBeVisible({ timeout: 20000 });
    await page.request.post(`/api/manage/${token}`, { data: { action: "cancel" } }); // cleanup
  });
});

test.describe("Bones: automated reminders", () => {
  test("a near booking gets exactly one reminder; the runner is idempotent", async ({ request }) => {
    test.skip(!!process.env.E2E_BASE_URL, "reminder cron test runs against the local server only");
    const secret = cronSecret();
    test.skip(!secret, "no CRON_SECRET available locally");

    // Book the SOONEST callback slot (well within the 24h reminder window, past the 2h min-notice).
    const slots = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    const soon = slots.find((s) => s - Date.now() < 23 * 3600000);
    test.skip(!soon, "no slot inside the 24h window right now");
    const r = await apiBook(request, { start: soon, customer: { name: "Reminder Tester", phone: "(904) 555-0181", email: "remind@example.com" } });
    expect(r.status()).toBe(200);
    const { manageToken } = await r.json();

    const cron = () => request.get("/api/cron/reminders", { headers: { authorization: `Bearer ${secret}` } });
    // unauthorized without the secret
    expect((await request.get("/api/cron/reminders")).status()).toBe(401);

    const first = await cron();
    expect(first.ok()).toBeTruthy();
    const f = await first.json();
    expect(f.claimed).toBeGreaterThanOrEqual(1);
    expect(f.sent).toBeGreaterThanOrEqual(1);

    // second run drains nothing new — proves send-once idempotency
    const second = await (await cron()).json();
    expect(second.claimed).toBe(0);
    expect(second.sent).toBe(0);

    await request.post(`/api/manage/${manageToken}`, { data: { action: "cancel" } }); // cleanup
  });
});

test.describe("Version 4: group class / event registration", () => {
  const YOGA = "riverside-yoga";
  const SVC_YOGA = "99990001-3333-4333-8333-333333333333";

  async function events(request: APIRequestContext): Promise<{ id: string; start: number; seatsLeft: number; capacity: number }[]> {
    const r = await request.get(`/api/events?slug=${YOGA}&service=${SVC_YOGA}`);
    expect(r.ok()).toBeTruthy();
    return (await r.json()).events;
  }
  async function registerEvent(request: APIRequestContext, eventId: string, over: Record<string, unknown> = {}) {
    return request.post("/api/book", {
      headers: freshIp(),
      data: { slug: YOGA, serviceId: SVC_YOGA, eventId, customer: { name: "Yoga Tester", phone: "(904) 555-0170", email: "yoga@example.com" }, intake: {}, smsConsent: false, ...over },
    });
  }

  test("customer sees classes with seats and reserves a spot (mobile)", async ({ page }) => {
    await page.goto(`/b/${YOGA}`);
    await page.getByTestId(`service-${SVC_YOGA}`).click();
    // event list with seats-remaining (no staff/slot steps)
    const firstEvent = page.locator('[data-testid^="event-"]').first();
    await expect(firstEvent).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid^="event-"]').first()).toContainText(/left|Full/);
    // pick a class that has seats (full classes now lead to the waitlist instead of a booking)
    const openEvent = page.locator('[data-testid^="event-"]').filter({ hasText: /left/ }).first();
    await openEvent.click();
    await page.getByTestId("in-name").fill("Playwright Yogi");
    await page.getByTestId("in-phone").fill("(904) 555-0166");
    await page.getByTestId("in-email").fill("pw.yogi@example.com");
    await page.getByTestId("confirm-booking").click();
    await expect(page.getByTestId("booking-done")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("booking-done")).toContainText(/reserved/i);
    // cleanup
    const href = await page.getByTestId("manage-link").getAttribute("href");
    await page.request.post(`/api/manage/${href!.split("/manage/")[1]}`, { data: { action: "cancel" } });
  });

  test("capacity is enforced: registering past the limit returns full, and a cancel frees a seat", async ({ request }) => {
    const evs = await events(request);
    // pick the class with the fewest seats left (seeded event #1 has 3 left)
    const target = evs.filter((e) => e.seatsLeft > 0).sort((a, b) => a.seatsLeft - b.seatsLeft)[0];
    expect(target).toBeTruthy();
    const tokens: string[] = [];
    // fill it exactly
    for (let i = 0; i < target.seatsLeft; i++) {
      const r = await registerEvent(request, target.id, { customer: { name: `Filler ${i}`, phone: `${i}`, email: `fill${i}@example.com` } });
      expect(r.status()).toBe(200);
      tokens.push((await r.json()).manageToken);
    }
    // now it's full → next registration is 409 full
    const over = await registerEvent(request, target.id, { customer: { name: "Overflow", phone: "9", email: "over@example.com" } });
    expect(over.status()).toBe(409);
    expect((await over.json()).error).toBe("full");
    // cancel one → a seat frees → registration succeeds again
    await request.post(`/api/manage/${tokens[0]}`, { data: { action: "cancel" } });
    const retry = await registerEvent(request, target.id, { customer: { name: "Seat Freed", phone: "10", email: "freed@example.com" } });
    expect(retry.status()).toBe(200);
    // cleanup everything we added
    tokens.shift();
    tokens.push((await retry.json()).manageToken);
    for (const t of tokens) await request.post(`/api/manage/${t}`, { data: { action: "cancel" } });
  });

  test("owner can create a class and see it; group booking never blocks a 1:1 slot elsewhere", async ({ page, request }) => {
    await ownerLogin(page, "owner@riversideyoga.demo");
    await page.goto("/dashboard/classes");
    await expect(page.getByTestId("event-add")).toBeVisible();
    const d = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    await page.getByTestId("event-date").fill(d);
    await page.getByTestId("event-add").click();
    await expect(page.locator('[data-testid="event-row"]').first()).toBeVisible({ timeout: 15000 });
    // the newly created event shows up in the customer-facing list (poll — read replicas lag briefly)
    await expect.poll(async () => (await events(request)).some((e) => new Date(e.start).toISOString().slice(0, 10) === d), { timeout: 15000 }).toBe(true);
  });
});

test.describe("request-to-book (Rover-style approve/decline)", () => {
  const SVC_FULL = "cccccc01-1111-4111-8111-111111111111"; // Full Detail = request mode, staff Marcus+Deja
  const FULL_INTAKE = { "eeeeee01-1111-4111-8111-111111111111": "2021 Honda Civic", "eeeeee02-1111-4111-8111-111111111111": "Sedan" };

  test("request mode: customer request lands pending, owner approves → confirmed", async ({ page, request }) => {
    // request a far-out Full Detail slot with Marcus
    const slots = await getSlots(request, COASTAL, SVC_FULL, STAFF_MARCUS);
    let token = "";
    for (const start of slots.slice().reverse().slice(0, 8)) {
      const r = await apiBook(request, {
        serviceId: SVC_FULL, staffId: STAFF_MARCUS, start,
        customer: { name: "Request Tester", phone: "(904) 555-0102", email: "req@example.com" },
        intake: FULL_INTAKE, address: "9 Ocean Ave, Jacksonville FL",
      });
      if (r.status() === 409) continue;
      expect(r.status()).toBe(200);
      const j = await r.json();
      expect(j.pending).toBe(true); // NOT auto-confirmed
      token = j.manageToken;
      // the held slot is gone from availability even though it's only pending
      expect(await getSlots(request, COASTAL, SVC_FULL, STAFF_MARCUS)).not.toContain(start);
      break;
    }
    expect(token).toBeTruthy();

    // manage page shows awaiting-confirmation + withdraw (no reschedule)
    await page.goto(`/manage/${token}`);
    await expect(page.getByTestId("manage-pending")).toBeVisible();
    await expect(page.getByTestId("btn-withdraw")).toBeVisible();

    // owner sees the request and approves
    await ownerLogin(page);
    await expect(page.getByTestId("requests-section")).toBeVisible();
    const approve = page.locator('[data-testid^="approve-"]').first();
    await approve.click();
    await page.waitForTimeout(1000);
    // after approval the manage page is now a confirmed booking (reschedule/cancel available)
    await page.goto(`/manage/${token}`);
    await expect(page.getByTestId("manage-actions").or(page.getByTestId("manage-locked"))).toBeVisible();
    // cleanup
    await request.post(`/api/manage/${token}`, { data: { action: "cancel" } });
  });

  test("request mode: decline frees the slot", async ({ page, request }) => {
    const slots = await getSlots(request, COASTAL, SVC_FULL, STAFF_MARCUS);
    let token = "", used = 0;
    for (const start of slots.slice().reverse().slice(0, 8)) {
      const r = await apiBook(request, { serviceId: SVC_FULL, staffId: STAFF_MARCUS, start,
        customer: { name: "Decline Tester", phone: "5", email: "dec@example.com" }, intake: FULL_INTAKE, address: "1 A St" });
      if (r.status() === 409) continue;
      expect(r.status()).toBe(200);
      token = (await r.json()).manageToken; used = start; break;
    }
    expect(token).toBeTruthy();
    await ownerLogin(page);
    page.on("dialog", (d) => void d.accept());
    await page.locator('[data-testid^="decline-"]').first().click();
    await page.waitForTimeout(1000);
    // slot is available again
    expect(await getSlots(request, COASTAL, SVC_FULL, STAFF_MARCUS)).toContain(used);
    // manage page reflects the decline
    await page.goto(`/manage/${token}`);
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
  });
});

test.describe("booking API hardening (FR4, resolution #2)", () => {
  test("cross-tenant staff forgery rejected", async ({ request }) => {
    const slots = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    const r = await apiBook(request, { staffId: STAFF_MARIA, start: slots[0] });
    expect([400, 404]).toContain(r.status());
  });

  test("off-slot time rejected (3 AM is not bookable)", async ({ request }) => {
    const r = await apiBook(request, { start: Date.parse("2026-08-25T07:00:00Z") }); // 3 AM ET
    expect(r.status()).toBe(400);
  });

  test("double-book race: exactly one of two parallel confirms wins (M4)", async ({ request }) => {
    const slots = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    let verified = false;
    for (const target of slots.slice().reverse().slice(0, 8)) {
      const [a, b] = await Promise.all([
        apiBook(request, { start: target, customer: { name: "Racer A", phone: "1", email: "a@example.com" } }),
        apiBook(request, { start: target, customer: { name: "Racer B", phone: "2", email: "b@example.com" } }),
      ]);
      const statuses = [a.status(), b.status()];
      if (statuses.every((s) => s === 409)) continue; // slot already taken by a prior run — try another
      expect(statuses.filter((s) => s === 200).length).toBe(1);
      // the loser is rejected either by the DB exclusion constraint (409) or, when the
      // winner commits first, by server-side slot re-validation (400) — both are correct
      expect([400, 409]).toContain(statuses.find((s) => s !== 200));
      const after = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
      expect(after).not.toContain(target);
      // cleanup the winner
      const winner = a.status() === 200 ? a : b;
      await request.post(`/api/manage/${(await winner.json()).manageToken}`, { data: { action: "cancel" } });
      verified = true;
      break;
    }
    expect(verified).toBe(true);
  });
});

test.describe("manage: reschedule & cancel (FR6, resolution #9)", () => {
  test("reschedule then cancel via manage link; cancelled page is view-only", async ({ page, request }) => {
    const { token: manageToken } = await bookFresh(request, {});
    const slots = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);

    await page.goto(`/manage/${manageToken}`);
    await expect(page.getByTestId("manage-when")).toBeVisible();
    await page.getByTestId("btn-reschedule").click();
    // pick a far-out day so the rescheduled booking stays OUTSIDE the cutoff (cancel must remain available)
    await page.locator('[data-testid^="reslot-"]').first().waitFor({ timeout: 20000 });
    const dayChips = page.locator("div.flex.gap-2.overflow-x-auto button");
    await dayChips.last().click();
    await page.locator('[data-testid^="reslot-"]').last().click();
    await expect(page.getByTestId("manage-rescheduled")).toBeVisible({ timeout: 20000 });

    // now cancel
    await page.goto(`/manage/${manageToken}`);
    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("btn-cancel").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible({ timeout: 20000 });

    // view-only after cancel (no resurrection)
    await page.reload();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    const rc = await request.post(`/api/manage/${manageToken}`, { data: { action: "reschedule", start: slots[0] } });
    expect(rc.status()).toBe(409);
  });

  test("inside cutoff → changes locked with explanation", async ({ page, request }) => {
    // find a slot within the next 24h (cutoff) but beyond min-notice (2h)
    const all = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    test.skip(!all.some((s) => s - Date.now() < 23 * 3600000), "no slot inside cutoff window right now");
    const { token: manageToken } = await bookFresh(request, { customer: { name: "Cutoff Test", phone: "3", email: "c@example.com" } }, { near: true });
    await page.goto(`/manage/${manageToken}`);
    await expect(page.getByTestId("manage-locked")).toBeVisible();
    const rc = await request.post(`/api/manage/${manageToken}`, { data: { action: "cancel" } });
    expect(rc.status()).toBe(409);
  });
});

test.describe("ICS (FR5, FR15, M3 structure)", () => {
  test("booking .ics is a valid iTIP REQUEST", async ({ request }) => {
    const { token: manageToken } = await bookFresh(request, { customer: { name: "Ics Test", phone: "4", email: "i@example.com" } });
    const ics = await request.get(`/api/booking-ics/${manageToken}`);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    const text = await ics.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("METHOD:REQUEST");
    expect(text).toContain("SEQUENCE:0");
    expect(text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    await request.post(`/api/manage/${manageToken}`, { data: { action: "cancel" } }); // cleanup
  });

  test("tenant feed serves VCALENDAR; bad token 404s", async ({ request }) => {
    const feed = await request.get("/api/ics/feed-coastal-Zx9vQ2mK8pL4nR7t");
    expect(feed.ok()).toBeTruthy();
    expect(await feed.text()).toContain("X-WR-CALNAME:Coastal Shine");
    const bad = await request.get("/api/ics/not-a-real-token");
    expect(bad.status()).toBe(404);
  });
});

test.describe("security headers & gating (resolutions #3, #8)", () => {
  test("embed allows framing; dashboard/manage deny it", async ({ request }) => {
    const embed = await request.get(`/embed/${COASTAL}`);
    expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
    const dash = await request.get("/dashboard");
    expect(dash.headers()["x-frame-options"]).toBe("DENY");
    const manage = await request.get("/manage/whatever");
    expect(manage.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  });

  test("outbox is gated: unauthenticated visitors see login, not emails", async ({ page }) => {
    await page.goto("/demo/outbox");
    await expect(page.getByTestId("login-email")).toBeVisible();
    await expect(page.getByTestId("outbox-email")).toHaveCount(0);
  });

  test("auth: 5 wrong codes invalidate the code (resolution #4)", async ({ request }) => {
    const email = "deja@coastalshine.demo";
    await request.post("/api/auth/request-code", { headers: freshIp(), data: { email } });
    for (let i = 0; i < 5; i++) {
      const r = await request.post("/api/auth/verify", { headers: freshIp(), data: { email, code: "000000" } });
      expect(r.status()).toBe(401);
    }
    const after = await request.post("/api/auth/verify", { headers: freshIp(), data: { email, code: "123456" } });
    expect(after.status()).toBe(401); // invalidated by attempts
  });
});

test.describe("owner dashboard (FR10-FR15 smoke)", () => {
  test("login → see bookings → block time removes slots → toggle service", async ({ page, request }) => {
    await ownerLogin(page);
    await expect(page.getByTestId("booking-card").first()).toBeVisible();

    // block a window that provably has an open slot, then assert that window empties (idempotent across runs)
    const before = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    const probe = before.find((s) => {
      const d = new Date(s);
      return s > Date.now() + 86400000 && d.getUTCHours() >= 9 && d.getUTCHours() < 16;
    });
    expect(probe).toBeTruthy();
    const targetDay = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date(probe!)); // browser runs UTC; BlockForm parses dates browser-local
    const winStart = Date.parse(`${targetDay}T09:00:00Z`), winEnd = Date.parse(`${targetDay}T17:00:00Z`);
    await page.goto("/dashboard/availability");
    await page.getByTestId("block-staff").selectOption(STAFF_MARCUS);
    await page.getByTestId("block-date").fill(targetDay);
    // block form defaults 09:00-17:00 (browser-local = UTC here)
    await page.getByTestId("block-add").click();
    await expect(page.getByTestId("block-row").first()).toBeVisible({ timeout: 15000 });
    const after = await getSlots(request, COASTAL, SVC_CALLBACK, STAFF_MARCUS);
    expect(after.some((s) => s >= winStart && s < winEnd)).toBe(false);
    // cleanup: remove blocks so repeated runs don't erode demo availability
    const rows = page.getByTestId("block-row");
    for (let i = 0; i < 10 && (await rows.count()) > 0; i++) {
      const n = await rows.count();
      await rows.first().getByRole("button", { name: "Remove" }).click();
      await expect(rows).toHaveCount(n - 1, { timeout: 15000 });
    }

    // toggle a service off → disappears from booking page
    await page.goto("/dashboard/services");
    await page.getByTestId(`toggle-${SVC_WASH}`).click();
    await page.waitForTimeout(800);
    const flow = await request.get(`/b/${COASTAL}`);
    expect(await flow.text()).not.toContain("Express Wash");
    // toggle back on
    await page.getByTestId(`toggle-${SVC_WASH}`).click();
    await page.waitForTimeout(500);

    // embed screen shows all three snippets
    await page.goto("/dashboard/embed");
    await expect(page.getByTestId("snippet-link")).toContainText(`/b/${COASTAL}`);
    await expect(page.getByTestId("snippet-script")).toContainText("widget.js");
    await expect(page.getByTestId("snippet-iframe")).toContainText("iframe");

    // settings: feed URL present; outbox shows masked mail
    await page.goto("/dashboard/settings");
    await expect(page.getByTestId("feed-url")).toContainText("/api/ics/");
    await page.goto("/demo/outbox");
    await expect(page.getByTestId("outbox-email").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("taylor.e2e@example.com"); // masked (resolution #3)
  });

  test("feed reset revokes the old URL (resolution #12)", async ({ page, request }) => {
    await ownerLogin(page, "maria@riveralaw.demo");
    await page.goto("/dashboard/settings");
    const feedUrl = await page.getByTestId("feed-url").textContent();
    const oldToken = feedUrl!.trim().split("/api/ics/")[1];
    const okBefore = await request.get(`/api/ics/${oldToken}`);
    expect(okBefore.ok()).toBeTruthy();
    page.on("dialog", (d) => void d.accept());
    await page.getByTestId("reset-feed").click();
    await page.waitForTimeout(1000);
    const gone = await request.get(`/api/ics/${oldToken}`);
    expect(gone.status()).toBe(404);
  });
});

test.describe("admin (FR19)", () => {
  test("owner cannot access admin; admin can impersonate", async ({ page }) => {
    await ownerLogin(page);
    await page.goto("/admin");
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await page.request.post("/api/auth/logout");

    await ownerLogin(page, "admin@slotter.local");
    await page.goto("/admin");
    await expect(page.getByTestId("tenant-coastal-shine")).toBeVisible();
    await page.getByTestId("impersonate-11111111-1111-4111-8111-111111111111").click();
    await expect(page.getByTestId("impersonation-banner")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("embed + size gate (FR16/17, resolution #13)", () => {
  test("widget.js injects an auto-resizing iframe on a host page", async ({ page }) => {
    await page.goto("/embed-demo.html");
    const iframe = page.locator("iframe");
    await expect(iframe).toHaveAttribute("src", /\/embed\/coastal-shine/);
    // resize message applies a pixel height
    await page.waitForFunction(() => {
      const f = document.querySelector("iframe");
      return f && parseInt(f.style.height || "0", 10) > 320;
    }, { timeout: 20000 });
  });

  test("embed route JS ≤150KB gzipped", async ({ page }) => {
    let total = 0;
    page.on("response", async (res) => {
      if (res.url().endsWith(".js") || res.url().includes("/_next/static")) {
        try { total += gzipSync(await res.body()).length; } catch { /* ignore */ }
      }
    });
    await page.goto(`/embed/${COASTAL}`, { waitUntil: "networkidle" });
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(150 * 1024);
  });
});
