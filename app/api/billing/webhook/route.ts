import { NextResponse } from "next/server";
import { applyBillingEvent } from "@/lib/billing";
import { captureError } from "@/lib/observe";

export const dynamic = "force-dynamic";

// Platform Stripe subscription webhook (market edition, prod). Verifies the signature with the
// platform webhook secret and applies subscription state changes to the tenant's plan.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_PLATFORM_SECRET_KEY;
  const whsec = process.env.STRIPE_BILLING_WEBHOOK_SECRET;
  if (!secret || !whsec) return NextResponse.json({ error: "not_configured" }, { status: 404 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "no_sig" }, { status: 400 });
  const raw = await req.text();
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secret);
  let event: import("stripe").Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, whsec);
  } catch {
    return NextResponse.json({ error: "bad_signature" }, { status: 400 });
  }
  try {
    const relevant = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"];
    if (relevant.includes(event.type)) {
      await applyBillingEvent(event.type, event.data.object as Parameters<typeof applyBillingEvent>[1]);
    }
  } catch (e) {
    captureError("billing.webhook", e, { eventType: event.type });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
