import { db } from "../db";
import type { Tenant, Service, Booking } from "../types";

export type CheckoutArgs = {
  tenant: Tenant;
  service: Service;
  booking: Booking;
  amountCents: number;
  baseUrl: string;
};

export type RefundArgs = { tenant: Tenant; booking: Booking; amountCents: number; idempotencyKey: string };

// ---- B3: no-show / late-cancel fee (card-on-file) ----
export type SaveCardArgs = { tenant: Tenant; booking: Booking };
export type SavedCardIntent = { clientSecret: string; publishableKey: string; customerId: string };
export type RecordCardArgs = { tenant: Tenant; booking: Booking; setupIntentId: string };
export type RecordedCard = { customerId: string; paymentMethodId: string };
export type ChargeFeeArgs = {
  tenant: Tenant; booking: Booking; amountCents: number; description: string; idempotencyKey: string;
  // True when a prior charge attempt is already on record for this booking (fee_charge_pending). In
  // that case the charge MUST reconcile with Stripe before creating a new PaymentIntent; if it can't,
  // it refuses rather than risk a duplicate once the idempotency key has expired.
  mustReconcile?: boolean;
};
export type ChargeFeeResult = { chargedCents: number; paymentRef: string };

export interface PaymentPort {
  /** Create a checkout and return the URL the customer should be sent to. */
  createCheckout(args: CheckoutArgs): Promise<{ url: string }>;
  /** Refund a captured payment. Idempotent via idempotencyKey. */
  refund(args: RefundArgs): Promise<void>;
  /** B3: begin vaulting a card (SetupIntent) — NO charge. Returns a client secret for the card form. */
  saveCardIntent(args: SaveCardArgs): Promise<SavedCardIntent>;
  /** B3: read the vaulted customer + payment method back from a SUCCEEDED SetupIntent we created. */
  recordSavedCard(args: RecordCardArgs): Promise<RecordedCard>;
  /** B3: charge a one-time fee off-session to the vaulted card. Idempotent via idempotencyKey. */
  chargeFee(args: ChargeFeeArgs): Promise<ChargeFeeResult>;
}

/** Demo adapter — a built-in test checkout page (NOT Stripe, no real charge). Proves the
 *  full pending→paid→confirmed flow with zero payment-provider dependency. */
class DemoPayments implements PaymentPort {
  async createCheckout(args: CheckoutArgs): Promise<{ url: string }> {
    return { url: `${args.baseUrl}/demo/pay/${args.booking.manage_token}` };
  }
  async refund(): Promise<void> { /* demo: no real money moved; the RPC records the refund event */ }
  // B3 demo: mirror the contract with no Stripe dependency and no real money.
  async saveCardIntent(args: SaveCardArgs): Promise<SavedCardIntent> {
    return { clientSecret: `seti_demo_${args.booking.id}_secret`, publishableKey: "pk_demo", customerId: `cus_demo_${args.booking.id}` };
  }
  async recordSavedCard(args: RecordCardArgs): Promise<RecordedCard> {
    return { customerId: `cus_demo_${args.booking.id}`, paymentMethodId: `pm_demo_${args.booking.id}` };
  }
  async chargeFee(args: ChargeFeeArgs): Promise<ChargeFeeResult> {
    // Demo: record intent to charge but move no real money.
    return { chargedCents: args.amountCents, paymentRef: `pi_demo_${args.idempotencyKey}` };
  }
}

/** Prod adapter — real Stripe Checkout on the tenant's OWN Stripe account (this app never touches PCI).
 *  Loads the tenant's secret key and creates a hosted Checkout Session. */
class StripePayments implements PaymentPort {
  async createCheckout(args: CheckoutArgs): Promise<{ url: string }> {
    const { data } = await db().from("bh_tenant_payments").select("*").eq("tenant_id", args.tenant.id).limit(1);
    const cfg = data?.[0];
    if (!cfg?.active || !cfg.stripe_secret_key) {
      throw new Error(`Stripe not configured for tenant ${args.tenant.slug}`);
    }
    // Lazy import so demo builds never require the stripe package at runtime.
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.stripe_secret_key as string);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: args.amountCents,
          product_data: { name: `${args.service.name} — deposit (${args.tenant.name})` },
        },
      }],
      customer_email: args.booking.customer.email,
      metadata: { booking_id: args.booking.id, tenant: args.tenant.slug },
      success_url: `${args.baseUrl}/manage/${args.booking.manage_token}?paid=1`,
      cancel_url: `${args.baseUrl}/b/${args.tenant.slug}?payment=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
    });
    await db().from("bh_bookings").update({ checkout_ref: session.id }).eq("id", args.booking.id);
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return { url: session.url };
  }

  async refund(args: RefundArgs): Promise<void> {
    const { data } = await db().from("bh_tenant_payments").select("*").eq("tenant_id", args.tenant.id).limit(1);
    const cfg = data?.[0];
    if (!cfg?.stripe_secret_key) throw new Error(`Stripe not configured for tenant ${args.tenant.slug}`);
    if (!args.booking.checkout_ref) throw new Error("no checkout reference to refund");
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.stripe_secret_key as string);
    // checkout_ref is the Checkout Session id → resolve its PaymentIntent, then refund it.
    const session = await stripe.checkout.sessions.retrieve(args.booking.checkout_ref);
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) throw new Error("no payment intent on session");
    await stripe.refunds.create(
      { payment_intent: pi, amount: args.amountCents > 0 ? args.amountCents : undefined },
      { idempotencyKey: args.idempotencyKey },   // R2: safe to retry, never double-refunds
    );
  }

  // Load the tenant's Stripe config, requiring it be active + keyed. Shared by the B3 methods.
  private async cfgFor(tenant: Tenant): Promise<{ secret: string; publishable: string }> {
    const { data } = await db().from("bh_tenant_payments").select("*").eq("tenant_id", tenant.id).limit(1);
    const cfg = data?.[0];
    if (!cfg?.active || !cfg.stripe_secret_key) throw new Error(`Stripe not configured for tenant ${tenant.slug}`);
    return { secret: cfg.stripe_secret_key as string, publishable: (cfg.stripe_publishable_key as string) ?? "" };
  }

  // B3: create a Customer + SetupIntent (off_session) on the tenant's account. No charge occurs.
  async saveCardIntent(args: SaveCardArgs): Promise<SavedCardIntent> {
    const cfg = await this.cfgFor(args.tenant);
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.secret);
    const customer = await stripe.customers.create({
      email: args.booking.customer.email, name: args.booking.customer.name,
      metadata: { booking_id: args.booking.id, tenant: args.tenant.slug },
    });
    const si = await stripe.setupIntents.create({
      customer: customer.id, usage: "off_session", payment_method_types: ["card"],
      metadata: { booking_id: args.booking.id, tenant: args.tenant.slug },
    });
    if (!si.client_secret) throw new Error("Stripe returned no SetupIntent client secret");
    return { clientSecret: si.client_secret, publishableKey: cfg.publishable, customerId: customer.id };
  }

  // B3: read back the vaulted PM + customer from a SUCCEEDED SetupIntent we created for THIS booking.
  async recordSavedCard(args: RecordCardArgs): Promise<RecordedCard> {
    const cfg = await this.cfgFor(args.tenant);
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.secret);
    const si = await stripe.setupIntents.retrieve(args.setupIntentId);
    // Ownership: the SetupIntent must be the one we minted for this exact booking.
    if (si.metadata?.booking_id !== args.booking.id) throw new Error("setup intent does not match booking");
    if (si.status !== "succeeded") throw new Error(`setup intent not completed (status ${si.status})`);
    const pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;
    const customer = typeof si.customer === "string" ? si.customer : si.customer?.id;
    if (!pm || !customer) throw new Error("setup intent missing payment method or customer");
    return { customerId: customer, paymentMethodId: pm };
  }

  // B3: charge the vaulted card off-session for a one-time fee. Idempotent via idempotencyKey.
  async chargeFee(args: ChargeFeeArgs): Promise<ChargeFeeResult> {
    if (args.amountCents <= 0) throw new Error("fee amount must be positive");
    const customer = args.booking.stripe_customer_id, pm = args.booking.stripe_payment_method_id;
    if (!customer || !pm) throw new Error("no card on file for this booking");
    const cfg = await this.cfgFor(args.tenant);
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(cfg.secret);
    // F1 — durable duplicate-capture guard that outlives the ~24h idempotency-key window: if a fee
    // PaymentIntent for THIS booking already succeeded (e.g. a prior attempt whose response we lost),
    // adopt it instead of creating a new charge. Search is eventually consistent (~1 min), which is
    // fine: the idempotency key + the fee_charged_cents marker cover the immediate window; this covers
    // the long-delayed retry, by which time the prior charge is always indexed.
    let searchFailed = false;
    try {
      const found = await stripe.paymentIntents.search({
        query: `metadata['booking_id']:'${args.booking.id}' AND metadata['kind']:'no_show_fee' AND status:'succeeded'`,
        limit: 1,
      });
      const prior = found.data[0];
      if (prior) return { chargedCents: prior.amount, paymentRef: prior.id };
    } catch { searchFailed = true; }
    // A prior attempt is on record but we could NOT confirm via search whether it captured. Refuse:
    // once the ~24h idempotency window is gone, creating a PaymentIntent here could double-charge.
    // (First-time charges — no prior attempt — are still safe to proceed: the idempotency key covers
    // the only window in which a duplicate could occur, and there is no earlier charge to duplicate.)
    if (searchFailed && args.mustReconcile) {
      throw new Error("fee reconcile unavailable — not charging to avoid a possible duplicate");
    }
    const pi = await stripe.paymentIntents.create(
      {
        amount: args.amountCents, currency: "usd", customer, payment_method: pm,
        off_session: true, confirm: true, description: args.description,
        metadata: { booking_id: args.booking.id, tenant: args.tenant.slug, kind: "no_show_fee" },
      },
      { idempotencyKey: args.idempotencyKey },
    );
    if (pi.status !== "succeeded") throw new Error(`fee charge not completed (status ${pi.status})`);
    return { chargedCents: args.amountCents, paymentRef: pi.id };
  }
}

export function paymentPort(mode: "demo" | "prod"): PaymentPort {
  return mode === "prod" ? new StripePayments() : new DemoPayments();
}
