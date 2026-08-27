import { describe, it, expect, vi, beforeEach } from "vitest";
import { tenantSettings, type Tenant, type Service, type Booking } from "../../lib/types";

// ---- Capture layer: mock the mail/sms ports and the owner-email lookup. ----
const sent = vi.hoisted(() => ({
  mail: [] as { to: string; subject: string; html: string }[],
  sms: [] as { to: string; body: string }[],
  smsEnabled: true,
  smsThrows: false,
}));
vi.mock("../../lib/services", () => ({
  getServices: () => ({
    mail: { send: async (m: { to: string; subject: string; html: string }) => { sent.mail.push(m); } },
    sms: {
      enabled: sent.smsEnabled,
      send: async (m: { to: string; body: string }) => { if (sent.smsThrows) throw new Error("sms down"); sent.sms.push(m); },
    },
  }),
}));
vi.mock("../../lib/repo", () => ({ ownerEmail: async () => "owner@shop.test" }));

import { sendReviewRequest } from "../../lib/booking";

const REVIEW_URL = "https://g.page/r/abc/review";

function tenant(over: Record<string, unknown> = {}): Tenant {
  return {
    id: "t1", slug: "shop", name: "The Shop", tz: "America/New_York",
    branding: { color: "#006778" },
    settings: { review_enabled: true, review_url: REVIEW_URL, review_delay_hours: 3, review_channel: "email", ...over } as unknown as Tenant["settings"],
    ics_token: "tok",
  };
}
function service(): Service {
  return { id: "s1", tenant_id: "t1", name: "Haircut", description: null, duration_min: 30, buffer_before_min: 0, buffer_after_min: 0, price_cents: 3500, kind: "appointment", location_mode: "business", active: true, sort: 0, booking_mode: "instant", capacity: 1, is_group: false, requires_payment: false, deposit_cents: null };
}
function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: "b1", tenant_id: "t1", service_id: "s1", staff_id: "st1",
    customer: { name: "Marcus Bell", phone: "+19045550111", email: "marcus@example.com" },
    intake_answers: {}, address: null, starts_at: "2026-08-20T14:00:00Z", ends_at: "2026-08-20T14:30:00Z",
    buffer_before_min: 0, buffer_after_min: 0, status: "confirmed",
    sms_consent: true, manage_token: "mt", ics_uid: "u", ics_sequence: 0,
    payment_status: "none", deposit_cents: null, created_at: "2026-08-20T13:00:00Z", ...over,
  };
}

beforeEach(() => { sent.mail = []; sent.sms = []; sent.smsEnabled = true; sent.smsThrows = false; });

describe("tenantSettings().reviewRequest derivation", () => {
  it("is disabled by default (no settings)", () => {
    const s = tenantSettings({ ...tenant(), settings: {} as Tenant["settings"] });
    expect(s.reviewRequest.enabled).toBe(false);
    expect(s.reviewRequest.delayHours).toBe(3); // sensible default
    expect(s.reviewRequest.channel).toBe("email");
  });
  it("stays disabled if enabled flag is set but URL is missing", () => {
    const s = tenantSettings(tenant({ review_enabled: true, review_url: "" }));
    expect(s.reviewRequest.enabled).toBe(false);
  });
  it("is enabled only with both the flag and a URL", () => {
    const s = tenantSettings(tenant({ review_enabled: true, review_url: REVIEW_URL }));
    expect(s.reviewRequest.enabled).toBe(true);
    expect(s.reviewRequest.url).toBe(REVIEW_URL);
  });
  it("normalizes an unknown channel back to email", () => {
    const s = tenantSettings(tenant({ review_channel: "carrier-pigeon" as unknown as "email" }));
    expect(s.reviewRequest.channel).toBe("email");
  });
});

describe("sendReviewRequest channel behavior", () => {
  it("email channel → one email with the review link, no SMS", async () => {
    await sendReviewRequest(tenant({ review_channel: "email" }), service(), booking());
    expect(sent.mail).toHaveLength(1);
    expect(sent.sms).toHaveLength(0);
    expect(sent.mail[0].to).toBe("marcus@example.com");
    expect(sent.mail[0].html).toContain(REVIEW_URL);
    expect(sent.mail[0].subject).toContain("The Shop");
  });

  it("sms channel with consent+provider → SMS only, link in body", async () => {
    await sendReviewRequest(tenant({ review_channel: "sms" }), service(), booking());
    expect(sent.sms).toHaveLength(1);
    expect(sent.mail).toHaveLength(0);
    expect(sent.sms[0].to).toBe("+19045550111");
    expect(sent.sms[0].body).toContain(REVIEW_URL);
  });

  it("sms channel WITHOUT consent → falls back to email (no silent drop)", async () => {
    await sendReviewRequest(tenant({ review_channel: "sms" }), service(), booking({ sms_consent: false }));
    expect(sent.sms).toHaveLength(0);
    expect(sent.mail).toHaveLength(1);
  });

  it("sms channel when the SMS send throws → still emails as fallback", async () => {
    sent.smsThrows = true;
    await sendReviewRequest(tenant({ review_channel: "sms" }), service(), booking());
    expect(sent.mail).toHaveLength(1);
  });

  it("both channel with consent → email AND SMS", async () => {
    await sendReviewRequest(tenant({ review_channel: "both" }), service(), booking());
    expect(sent.mail).toHaveLength(1);
    expect(sent.sms).toHaveLength(1);
  });

  it("both channel without SMS consent → email only, no throw", async () => {
    await sendReviewRequest(tenant({ review_channel: "both" }), service(), booking({ sms_consent: false }));
    expect(sent.mail).toHaveLength(1);
    expect(sent.sms).toHaveLength(0);
  });

  it("no review URL configured → sends nothing (guard)", async () => {
    await sendReviewRequest(tenant({ review_url: "" }), service(), booking());
    expect(sent.mail).toHaveLength(0);
    expect(sent.sms).toHaveLength(0);
  });
});
