import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Service, Booking, Tenant } from "../../lib/types";

// ---- shared state controlling the mocked repo / payment port / db ----
const state = vi.hoisted(() => ({
  booking: null as unknown,
  service: null as unknown,
  tenant: null as unknown,
  chargeResult: { chargedCents: 0, paymentRef: "pi_x" } as { chargedCents: number; paymentRef: string },
  chargeThrows: false,
  chargeCalls: [] as unknown[],
  updates: [] as unknown[],
  events: [] as unknown[],
}));
vi.mock("../../lib/repo", () => ({
  bookingById: async () => state.booking,
  serviceById: async () => state.service,
  tenantById: async () => state.tenant,
}));
vi.mock("../../lib/services", () => ({
  getServices: () => ({
    pay: {
      chargeFee: async (a: unknown) => {
        if (state.chargeThrows) throw new Error("card_declined");
        state.chargeCalls.push(a);
        return state.chargeResult;
      },
    },
  }),
}));
vi.mock("../../lib/observe", () => ({ captureError: () => {} }));
vi.mock("../../lib/db", () => {
  const from = (table: string) => ({
    update: (row: unknown) => ({ eq: () => ({ is: () => { state.updates.push({ table, row }); return Promise.resolve({ error: null }); } }) }),
    insert: (row: unknown) => { state.events.push({ table, row }); return Promise.resolve({ error: null }); },
  });
  return { db: () => ({ from }) };
});

import { chargeNoShowFee, computeFeeCents } from "../../lib/booking";

function service(over: Partial<Service> = {}): Service {
  return { id: "s1", tenant_id: "t1", name: "Cut", description: null, duration_min: 30, buffer_before_min: 0, buffer_after_min: 0, price_cents: 4000, kind: "appointment", location_mode: "business", active: true, sort: 0, booking_mode: "instant", capacity: 1, is_group: false, requires_payment: false, deposit_cents: null, protect_no_show: true, no_show_fee_cents: 2500, fee_model: "flat", ...over };
}
function booking(over: Partial<Booking> = {}): Booking {
  return { id: "b1", tenant_id: "t1", service_id: "s1", staff_id: "st1", customer: { name: "Pat", phone: "+1", email: "p@x.com" }, intake_answers: {}, address: null, starts_at: "2026-08-20T14:00:00Z", ends_at: "2026-08-20T14:30:00Z", buffer_before_min: 0, buffer_after_min: 0, status: "confirmed", sms_consent: false, manage_token: "mt", ics_uid: "u", ics_sequence: 0, payment_status: "none", deposit_cents: null, no_show: true, stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1", fee_charged_cents: null, fee_quote_cents: 2500, created_at: "x", ...over };
}
const tenant: Tenant = { id: "t1", slug: "shop", name: "Shop", tz: "America/New_York", branding: {}, settings: {}, ics_token: "t" };

describe("computeFeeCents", () => {
  it("flat → the cents value", () => expect(computeFeeCents(service({ fee_model: "flat", no_show_fee_cents: 2500 }))).toBe(2500));
  it("percent → percent of price, rounded", () => expect(computeFeeCents(service({ fee_model: "percent", no_show_fee_cents: 50, price_cents: 4000 }))).toBe(2000));
  it("percent clamps above 100%", () => expect(computeFeeCents(service({ fee_model: "percent", no_show_fee_cents: 150, price_cents: 4000 }))).toBe(4000));
  it("percent with no price → 0", () => expect(computeFeeCents(service({ fee_model: "percent", no_show_fee_cents: 50, price_cents: null }))).toBe(0));
  it("not protected → 0", () => expect(computeFeeCents(service({ protect_no_show: false, no_show_fee_cents: 2500 }))).toBe(0));
  it("zero/blank fee → 0", () => expect(computeFeeCents(service({ no_show_fee_cents: 0 }))).toBe(0));
});

describe("chargeNoShowFee guards", () => {
  beforeEach(() => {
    state.booking = booking(); state.service = service(); state.tenant = tenant;
    state.chargeThrows = false; state.chargeCalls = []; state.updates = []; state.events = [];
    state.chargeResult = { chargedCents: 2500, paymentRef: "pi_ok" };
  });

  it("charges the exact fee once and records it (happy path)", async () => {
    const r = await chargeNoShowFee("b1");
    expect(r).toEqual({ ok: true, chargedCents: 2500 });
    expect(state.chargeCalls).toHaveLength(1);
    expect((state.chargeCalls[0] as { amountCents: number; idempotencyKey: string }).amountCents).toBe(2500);
    expect((state.chargeCalls[0] as { idempotencyKey: string }).idempotencyKey).toBe("noshowfee_b1");
    expect(state.updates).toHaveLength(1); // marked charged
    expect(state.events).toHaveLength(1); // audit event
  });

  it("refuses when the service isn't protected", async () => {
    state.service = service({ protect_no_show: false });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "not_protected" });
    expect(state.chargeCalls).toHaveLength(0);
  });

  it("refuses when the booking isn't a no-show", async () => {
    state.booking = booking({ no_show: false, status: "confirmed" });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "not_eligible" });
    expect(state.chargeCalls).toHaveLength(0);
  });

  it("does NOT charge an on-time cancellation (F3 — status cancelled, not a no-show)", async () => {
    state.booking = booking({ no_show: false, status: "cancelled" });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "not_eligible" });
    expect(state.chargeCalls).toHaveLength(0);
  });

  it("charges the DISCLOSED snapshot, not a later-edited service fee (F2)", async () => {
    state.booking = booking({ fee_quote_cents: 2000 });     // disclosed $20
    state.service = service({ no_show_fee_cents: 9900 });    // owner later raised it to $99
    state.chargeResult = { chargedCents: 2000, paymentRef: "pi_ok" };
    const r = await chargeNoShowFee("b1");
    expect(r.chargedCents).toBe(2000);
    expect((state.chargeCalls[0] as { amountCents: number }).amountCents).toBe(2000); // snapshot wins
  });

  it("never double-charges an already-charged booking", async () => {
    state.booking = booking({ fee_charged_cents: 2500 });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "already_charged" });
    expect(state.chargeCalls).toHaveLength(0);
  });

  it("refuses when no card is on file", async () => {
    state.booking = booking({ stripe_payment_method_id: null });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "no_card" });
    expect(state.chargeCalls).toHaveLength(0);
  });

  it("refuses when the fee is 0 (no snapshot and nothing configured)", async () => {
    state.booking = booking({ fee_quote_cents: null });
    state.service = service({ no_show_fee_cents: 0 });
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "no_fee" });
  });

  it("does NOT mark charged when the charge fails (safe retry)", async () => {
    state.chargeThrows = true;
    expect(await chargeNoShowFee("b1")).toEqual({ ok: false, reason: "charge_failed" });
    expect(state.updates).toHaveLength(0); // fee_charged_cents stays null → retry allowed
  });
});
