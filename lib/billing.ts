// Billing meter for the market edition (H5). This is the PLATFORM charging the business owner
// (Slotter's own Stripe), separate from each tenant's own Stripe used for customer deposits.
// Demo-complete: with no platform Stripe configured, "upgrade" flips the plan locally so the
// whole flow is exercisable. Prod: SLOTTER_BILLING=stripe wires a real subscription Checkout.
import { db } from "./db";
import { isMarket } from "./edition";
import type { Tenant } from "./types";

export type PlanState = { plan: "free" | "pro"; status: "active" | "past_due" | "canceled"; active: boolean };

const billingOn = () => isMarket() && process.env.SLOTTER_BILLING === "stripe";

export async function planStateFor(tenantId: string): Promise<PlanState> {
  const { data } = await db().from("bh_tenant_billing").select("plan, status").eq("tenant_id", tenantId).limit(1);
  const row = data?.[0] as { plan: "free" | "pro"; status: PlanState["status"] } | undefined;
  const plan = row?.plan ?? "free";
  const status = row?.status ?? "active";
  return { plan, status, active: status === "active" };
}

async function setPlan(tenantId: string, patch: Partial<{ plan: string; status: string; stripe_customer_id: string; stripe_subscription_id: string; current_period_end: string | null }>) {
  await db().from("bh_tenant_billing").upsert({ tenant_id: tenantId, updated_at: new Date().toISOString(), ...patch });
}

export type CheckoutResult = { url: string };

/** Start an upgrade. Demo (no platform Stripe): flip to pro immediately and bounce back.
 *  Prod: create a Stripe subscription Checkout the owner is redirected to. */
export async function startBillingCheckout(tenant: Tenant, baseUrl: string): Promise<CheckoutResult> {
  if (!billingOn()) {
    await setPlan(tenant.id, { plan: "pro", status: "active" });
    return { url: `${baseUrl}/dashboard/billing?upgraded=1` };
  }
  const secret = process.env.STRIPE_PLATFORM_SECRET_KEY, price = process.env.STRIPE_PRICE_ID;
  if (!secret || !price) throw new Error("STRIPE_PLATFORM_SECRET_KEY / STRIPE_PRICE_ID not configured");
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    metadata: { tenant_id: tenant.id },
    subscription_data: { metadata: { tenant_id: tenant.id } },
    success_url: `${baseUrl}/dashboard/billing?upgraded=1`,
    cancel_url: `${baseUrl}/dashboard/billing?cancelled=1`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  return { url: session.url };
}

/** Apply a Stripe subscription webhook event to a tenant's plan (prod). */
export async function applyBillingEvent(type: string, obj: { metadata?: { tenant_id?: string }; status?: string; current_period_end?: number; customer?: string; id?: string }): Promise<void> {
  const tenantId = obj.metadata?.tenant_id;
  if (!tenantId) return;
  if (type === "customer.subscription.deleted") {
    await setPlan(tenantId, { plan: "free", status: "canceled", stripe_subscription_id: obj.id });
    return;
  }
  // created/updated + checkout.session.completed
  const status = obj.status === "active" || obj.status === "trialing" ? "active" : obj.status === "past_due" ? "past_due" : "active";
  await setPlan(tenantId, {
    plan: status === "active" ? "pro" : "free", status,
    stripe_customer_id: typeof obj.customer === "string" ? obj.customer : undefined,
    stripe_subscription_id: obj.id,
    current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
  });
}
