import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { markBookingPaid } from "@/lib/booking";
import { captureError } from "@/lib/observe";

export const dynamic = "force-dynamic";

// Prod Stripe webhook. Verifies the signature with the tenant's webhook secret (looked up from the
// session's tenant metadata) and confirms the booking on checkout.session.completed.
export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "no_sig" }, { status: 400 });
  const raw = await req.text();

  // We can't know the tenant before parsing, so verify against each active tenant secret until one
  // matches (small N; multi-tenant single-endpoint pattern). Alternatively route per-tenant later.
  const { data: creds } = await db().from("bh_tenant_payments").select("tenant_id, stripe_webhook_secret").eq("active", true);
  const Stripe = (await import("stripe")).default;
  let event: import("stripe").Stripe.Event | null = null;
  for (const c of creds ?? []) {
    if (!c.stripe_webhook_secret) continue;
    try {
      event = new Stripe("sk_placeholder").webhooks.constructEvent(raw, sig, c.stripe_webhook_secret as string);
      break;
    } catch { /* try next tenant secret */ }
  }
  if (!event) return NextResponse.json({ error: "bad_signature" }, { status: 400 });

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      const bookingId = session.metadata?.booking_id;
      if (bookingId) await markBookingPaid(bookingId, session.id);
    }
  } catch (e) {
    // Payment captured but our confirm failed — must not be lost.
    captureError("stripe.webhook", e, { eventType: event.type });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
