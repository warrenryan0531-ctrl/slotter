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

export interface PaymentPort {
  /** Create a checkout and return the URL the customer should be sent to. */
  createCheckout(args: CheckoutArgs): Promise<{ url: string }>;
  /** Refund a captured payment. Idempotent via idempotencyKey. */
  refund(args: RefundArgs): Promise<void>;
}

/** Demo adapter — a built-in test checkout page (NOT Stripe, no real charge). Proves the
 *  full pending→paid→confirmed flow with zero payment-provider dependency. */
class DemoPayments implements PaymentPort {
  async createCheckout(args: CheckoutArgs): Promise<{ url: string }> {
    return { url: `${args.baseUrl}/demo/pay/${args.booking.manage_token}` };
  }
  async refund(): Promise<void> { /* demo: no real money moved; the RPC records the refund event */ }
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
}

export function paymentPort(mode: "demo" | "prod"): PaymentPort {
  return mode === "prod" ? new StripePayments() : new DemoPayments();
}
