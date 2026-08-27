import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { db } from "@/lib/db";
import { getServices } from "@/lib/services";
import { rateLimit, ipOf } from "@/lib/ratelimit";

// B3: after the customer confirms the SetupIntent client-side, record the vaulted customer +
// payment method onto their booking. Public, but gated by the per-booking manage_token AND by
// recordSavedCard verifying the SetupIntent's metadata.booking_id matches this booking. No charge.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit(`cardsaved:${ipOf(req)}`, 300, 20))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const manageToken = String(body.manageToken ?? "");
  const setupIntentId = String(body.setupIntentId ?? "");
  if (!manageToken || !setupIntentId) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const booking = await repo.bookingByManageToken(manageToken);
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const tenant = await repo.tenantById(booking.tenant_id);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (booking.stripe_payment_method_id) return NextResponse.json({ ok: true }); // already recorded — idempotent

  try {
    const { pay } = getServices();
    const card = await pay.recordSavedCard({ tenant, booking, setupIntentId });
    await db().from("bh_bookings")
      .update({ stripe_customer_id: card.customerId, stripe_payment_method_id: card.paymentMethodId })
      .eq("id", booking.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[b3] record saved card failed:", (e as Error).message);
    return NextResponse.json({ error: "card_not_saved" }, { status: 400 });
  }
}
