import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { sendReminder, sendReviewRequest } from "@/lib/booking";
import { reconcileOrphanedCalendarEvents } from "@/lib/calendar";
import { captureError } from "@/lib/observe";
import { tenantSettings } from "@/lib/types";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Cadence-independent reminder runner. Vercel Cron hits this on a schedule; it can also be
// invoked manually with the CRON_SECRET. For each tenant's configured reminder offsets, it finds
// confirmed future bookings whose window has opened and that haven't been reminded for that kind,
// claims each atomically (bh_claim_reminder), and emails the customer. Safe to run any frequency.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  const isVercelCron = req.headers.get("x-vercel-cron") !== null;
  if (secret && auth !== `Bearer ${secret}` && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const d = db();
  // Housekeeping: release abandoned paid-booking holds so a slot never stays locked (V3).
  const sweep = await d.rpc("bh_sweep_unpaid");
  const swept = (sweep.data as number) ?? 0;
  // H4: garbage-collect calendar events orphaned by a failed delete (best-effort).
  let reconciled = 0;
  try { reconciled = await reconcileOrphanedCalendarEvents(50); }
  catch (e) { captureError("cron.reconcile", e); }
  const { data: tenants } = await d.from("bh_tenants").select("*");
  let sent = 0, claimed = 0, reviews = 0;
  const svcCache = new Map<string, Awaited<ReturnType<typeof repo.serviceById>>>();
  const svc = async (id: string) => {
    let s = svcCache.get(id);
    if (s === undefined) { s = await repo.serviceById(id); svcCache.set(id, s); }
    return s;
  };

  for (const t of tenants ?? []) {
    const offsets = tenantSettings(t).reminderHours;
    for (const hours of offsets) {
      const kind = `${hours}h`;
      const { data: due } = await d.rpc("bh_due_reminders", { p_tenant_id: t.id, p_kind: kind, p_hours: hours });
      for (const row of (due ?? []) as { booking_id: string }[]) {
        const ok = await d.rpc("bh_claim_reminder", { p_booking_id: row.booking_id, p_kind: kind });
        if (ok.error || ok.data !== true) continue; // already reminded / lost the race
        claimed++;
        const booking = await repo.bookingById(row.booking_id);
        if (!booking || booking.tenant_id !== t.id || booking.status !== "confirmed") continue;
        const service = await svc(booking.service_id);
        if (!service) continue;
        try {
          await sendReminder(t, service, booking as Booking, kind);
          sent++;
        } catch {
          // send failed after claim — a reminder may be missed rather than duplicated (safe direction)
        }
      }
    }

    // B2: post-visit review requests. Same claim-then-send idempotency as reminders.
    const rr = tenantSettings(t).reviewRequest;
    if (rr.enabled) {
      const { data: dueR } = await d.rpc("bh_due_review_requests", { p_tenant_id: t.id, p_delay_hours: rr.delayHours });
      for (const row of (dueR ?? []) as { booking_id: string }[]) {
        const ok = await d.rpc("bh_claim_reminder", { p_booking_id: row.booking_id, p_kind: "review" });
        if (ok.error || ok.data !== true) continue; // already asked / lost the race
        const booking = await repo.bookingById(row.booking_id);
        if (!booking || booking.tenant_id !== t.id || booking.status !== "confirmed" || booking.no_show) continue;
        const service = await svc(booking.service_id);
        if (!service) continue;
        try {
          await sendReviewRequest(t, service, booking as Booking);
          reviews++;
        } catch {
          // send failed after claim — one ask may be missed rather than duplicated (safe direction)
        }
      }
    }
  }
  return NextResponse.json({ ok: true, claimed, sent, reviews, swept, reconciled });
}
