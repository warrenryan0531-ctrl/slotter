import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { notifyBooking, slotInputFor, refundBooking, promoteWaitlist } from "@/lib/booking";
import { generateSlots } from "@/lib/engine/slots";
import { tenantSettings } from "@/lib/types";
import { rateLimit, ipOf } from "@/lib/ratelimit";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!(await rateLimit(`manage:${ipOf(req)}`, 300, 20))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const booking = await repo.bookingByManageToken(token);
  if (!booking) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (booking.status === "cancelled" || booking.status === "declined") return NextResponse.json({ error: "cancelled" }, { status: 409 });

  const tenant = await repo.tenantById(booking.tenant_id);
  const service = await repo.serviceById(booking.service_id);
  if (!tenant || !service) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const staffList = await repo.staffForTenant(tenant.id);
  const staff = staffList.find((s) => s.id === booking.staff_id) ?? staffList[0];

  let body: { action?: string; start?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  // A still-pending request can always be withdrawn (nothing is confirmed); reschedule is not offered until confirmed.
  if (booking.status === "pending") {
    if (body.action !== "cancel") return NextResponse.json({ error: "pending" }, { status: 409 });
    const { data, error } = await db().rpc("bh_cancel_booking", { p_booking_id: booking.id, p_actor: "customer" });
    if (error || !(data as { ok: boolean }).ok) return NextResponse.json({ error: "failed" }, { status: 500 });
    if (booking.event_id) await promoteWaitlist(booking.event_id); // free a class seat → next waitlister
    return NextResponse.json({ ok: true });
  }

  // cutoff window applies to customer-initiated changes on confirmed bookings
  const cutoffMs = tenantSettings(tenant).cutoffHours * 3600000;
  if (Date.parse(booking.starts_at) - Date.now() < cutoffMs) {
    return NextResponse.json({ error: "inside_cutoff" }, { status: 409 });
  }

  if (body.action === "cancel") {
    const { data, error } = await db().rpc("bh_cancel_booking", { p_booking_id: booking.id, p_actor: "customer" });
    if (error || !(data as { ok: boolean }).ok) return NextResponse.json({ error: "failed" }, { status: 500 });
    const updated = await repo.bookingById(booking.id);
    await notifyBooking(tenant, service, staff, updated!, "cancelled");
    if (booking.payment_status === "paid") await refundBooking(booking.id); // E4: refund on eligible cancel
    if (booking.event_id) await promoteWaitlist(booking.event_id);          // E4: promote next waitlister
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reschedule") {
    const start = Number(body.start ?? 0);
    // full slot re-validation on the target time (resolution #9) — exclude this booking's own busy span
    const inp = await slotInputFor(tenant, service, booking.staff_id, Date.now());
    const selfStart = Date.parse(booking.starts_at) - booking.buffer_before_min * 60000;
    const selfEnd = Date.parse(booking.ends_at) + booking.buffer_after_min * 60000;
    inp.busy = inp.busy.filter((b) => !(b.start === selfStart && b.end === selfEnd));
    if (!generateSlots(inp).some((s) => s.start === start)) {
      return NextResponse.json({ error: "invalid_slot" }, { status: 400 });
    }
    const end = start + service.duration_min * 60000;
    const { data, error } = await db().rpc("bh_reschedule_booking", {
      p_booking_id: booking.id, p_starts_at: new Date(start).toISOString(),
      p_ends_at: new Date(end).toISOString(), p_actor: "customer",
    });
    if (error) {
      if (error.message.includes("BH_BLOCKED")) return NextResponse.json({ error: "conflict" }, { status: 409 });
      return NextResponse.json({ error: "failed" }, { status: 500 });
    }
    const res = data as { ok: boolean; reason?: string };
    if (!res.ok) return NextResponse.json({ error: res.reason ?? "conflict" }, { status: 409 });
    const updated = await repo.bookingById(booking.id);
    await notifyBooking(tenant, service, staff, updated!, "rescheduled");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
