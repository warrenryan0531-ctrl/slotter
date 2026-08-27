import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tenant, Service, Booking } from "../../lib/types";

// Prove the Stripe adapter's request shapes with the `stripe` SDK and `lib/db` both mocked:
// checkout carries metadata + expiry, and refund resolves the PaymentIntent and passes an
// idempotency key + server-computed amount (R2). No live Stripe account needed.

const created = { checkout: vi.fn(), refund: vi.fn(), retrieve: vi.fn(), piCreate: vi.fn(), piSearch: vi.fn() };

vi.mock("stripe", () => {
  return { default: class {
    checkout = { sessions: {
      create: (...a: unknown[]) => created.checkout(...a),
      retrieve: (...a: unknown[]) => created.retrieve(...a),
    } };
    refunds = { create: (...a: unknown[]) => created.refund(...a) };
    paymentIntents = {
      create: (...a: unknown[]) => created.piCreate(...a),
      search: (...a: unknown[]) => created.piSearch(...a),
    };
  } };
});

const tenantPayments = { active: true, stripe_secret_key: "sk_test_x" };
const updateMock = vi.fn();
vi.mock("../../lib/db", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ limit: async () => ({ data: [tenantPayments] }) }) }),
      update: () => ({ eq: updateMock }),
    }),
  }),
}));

const tenant = { id: "t1", slug: "acme", name: "Acme" } as Tenant;
const service = { id: "s1", name: "Detail", tenant_id: "t1" } as Service;
const booking = { id: "bk1", manage_token: "mt", checkout_ref: "cs_123", customer: { email: "c@x.com" } } as Booking;

const feeBooking = { ...booking, stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1" } as Booking;

beforeEach(() => { created.checkout.mockReset(); created.refund.mockReset(); created.retrieve.mockReset(); created.piCreate.mockReset(); created.piSearch.mockReset(); updateMock.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("StripePayments", () => {
  it("createCheckout sends metadata, customer email, and a bounded expiry", async () => {
    created.checkout.mockResolvedValueOnce({ id: "cs_new", url: "https://stripe/pay" });
    const { paymentPort } = await import("../../lib/services/payments");
    const { url } = await paymentPort("prod").createCheckout({ tenant, service, booking, amountCents: 5000, baseUrl: "https://host" });
    expect(url).toBe("https://stripe/pay");
    const arg = created.checkout.mock.calls[0][0];
    expect(arg.mode).toBe("payment");
    expect(arg.line_items[0].price_data.unit_amount).toBe(5000);
    expect(arg.metadata.booking_id).toBe("bk1");
    expect(arg.customer_email).toBe("c@x.com");
    expect(arg.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("refund resolves the PaymentIntent and passes amount + idempotency key (R2)", async () => {
    created.retrieve.mockResolvedValueOnce({ payment_intent: "pi_123" });
    created.refund.mockResolvedValueOnce({ id: "re_1" });
    const { paymentPort } = await import("../../lib/services/payments");
    await paymentPort("prod").refund({ tenant, booking, amountCents: 5000, idempotencyKey: "bk1:refund" });
    expect(created.retrieve).toHaveBeenCalledWith("cs_123");
    const [params, opts] = created.refund.mock.calls[0];
    expect(params.payment_intent).toBe("pi_123");
    expect(params.amount).toBe(5000);
    expect(opts.idempotencyKey).toBe("bk1:refund");
  });

  // ---- B3 chargeFee: off-session charge + duplicate-capture guards ----
  it("chargeFee creates an off-session PaymentIntent when no prior charge exists", async () => {
    created.piSearch.mockResolvedValueOnce({ data: [] });
    created.piCreate.mockResolvedValueOnce({ id: "pi_new", status: "succeeded" });
    const { paymentPort } = await import("../../lib/services/payments");
    const res = await paymentPort("prod").chargeFee({ tenant, booking: feeBooking, amountCents: 2500, description: "fee", idempotencyKey: "noshowfee_bk1" });
    expect(res).toEqual({ chargedCents: 2500, paymentRef: "pi_new" });
    const [params, opts] = created.piCreate.mock.calls[0];
    expect(params.off_session).toBe(true);
    expect(params.confirm).toBe(true);
    expect(params.amount).toBe(2500);
    expect(params.metadata.kind).toBe("no_show_fee");
    expect(opts.idempotencyKey).toBe("noshowfee_bk1");
  });

  it("chargeFee ADOPTS a prior succeeded PaymentIntent instead of charging again", async () => {
    created.piSearch.mockResolvedValueOnce({ data: [{ id: "pi_prior", amount: 2500 }] });
    const { paymentPort } = await import("../../lib/services/payments");
    const res = await paymentPort("prod").chargeFee({ tenant, booking: feeBooking, amountCents: 2500, description: "fee", idempotencyKey: "noshowfee_bk1" });
    expect(res).toEqual({ chargedCents: 2500, paymentRef: "pi_prior" });
    expect(created.piCreate).not.toHaveBeenCalled(); // no second charge
  });

  it("chargeFee REFUSES when a prior attempt exists but search is unavailable (never double-charges)", async () => {
    created.piSearch.mockRejectedValueOnce(new Error("search down"));
    const { paymentPort } = await import("../../lib/services/payments");
    await expect(paymentPort("prod").chargeFee({ tenant, booking: feeBooking, amountCents: 2500, description: "fee", idempotencyKey: "noshowfee_bk1", mustReconcile: true }))
      .rejects.toThrow(/reconcile unavailable/);
    expect(created.piCreate).not.toHaveBeenCalled(); // refused, no charge
  });

  it("chargeFee still charges a FIRST attempt even if search is unavailable (idempotency key covers it)", async () => {
    created.piSearch.mockRejectedValueOnce(new Error("search down"));
    created.piCreate.mockResolvedValueOnce({ id: "pi_first", status: "succeeded" });
    const { paymentPort } = await import("../../lib/services/payments");
    const res = await paymentPort("prod").chargeFee({ tenant, booking: feeBooking, amountCents: 2500, description: "fee", idempotencyKey: "noshowfee_bk1", mustReconcile: false });
    expect(res.paymentRef).toBe("pi_first");
  });
});
