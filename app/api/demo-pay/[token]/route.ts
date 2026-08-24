import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { markBookingPaid } from "@/lib/booking";
import { db } from "@/lib/db";
import { appMode } from "@/lib/env";
import { rateLimit, ipOf } from "@/lib/ratelimit";

// Simulated payment result for the DEMO checkout page. Demo mode only.
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (appMode() !== "demo") return NextResponse.json({ error: "not_demo" }, { status: 403 });
  if (!(await rateLimit(`demopay:${ipOf(req)}`, 300, 30))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { token } = await ctx.params;
  const booking = await repo.bookingByManageToken(token);
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  if (body.action === "pay") {
    await markBookingPaid(booking.id, "demo-checkout");
    return NextResponse.json({ ok: true });
  }
  if (body.action === "cancel") {
    // release the unpaid hold immediately (frees the slot)
    await db().rpc("bh_cancel_booking", { p_booking_id: booking.id, p_actor: "customer" });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
