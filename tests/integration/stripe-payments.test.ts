import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Tenant, Service, Booking } from "../../lib/types";

// Prove the Stripe adapter's request shapes with the `stripe` SDK and `lib/db` both mocked:
// checkout carries metadata + expiry, and refund resolves the PaymentIntent and passes an
// idempotency key + server-computed amount (R2). No live Stripe account needed.

const created = { checkout: vi.fn(), refund: vi.fn(), retrieve: vi.fn() };

vi.mock("stripe", () => {
  return { default: class {
    checkout = { sessions: {
      create: (...a: unknown[]) => created.checkout(...a),
      retrieve: (...a: unknown[]) => created.retrieve(...a),
    } };
    refunds = { create: (...a: unknown[]) => created.refund(...a) };
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

beforeEach(() => { created.checkout.mockReset(); created.refund.mockReset(); created.retrieve.mockReset(); updateMock.mockReset(); });
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
});
