import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { sendReminder } from "@/lib/booking";
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
  let sent = 0, claimed = 0;
  const svcCache = new Map<string, Awaited<ReturnType<typeof repo.serviceById>>>();

  for (const t of tenants ?? []) {
    const offsets = tenantSettings(t).reminderHours;
    for (const hours of offsets) {
      const kind = `${hours}h`;
      const { data: due } = await d.rpc("bh_due_reminders", { p_kind: kind, p_hours: hours });
      for (const row of (due ?? []) as { booking_id: string }[]) {
        const ok = await d.rpc("bh_claim_reminder", { p_booking_id: row.booking_id, p_kind: kind });
        if (ok.error || ok.data !== true) continue; // already reminded / lost the race
        claimed++;
        const booking = await repo.bookingById(row.booking_id);
        if (!booking || booking.status !== "confirmed") continue;
        let service = svcCache.get(booking.service_id);
        if (service === undefined) { service = await repo.serviceById(booking.service_id); svcCache.set(booking.service_id, service); }
        if (!service) continue;
        try {
          await sendReminder(t, service, booking as Booking, kind);
          sent++;
        } catch {
          // send failed after claim — a reminder may be missed rather than duplicated (safe direction)
        }
      }
    }
  }
  return NextResponse.json({ ok: true, claimed, sent, swept, reconciled });
}
