// B4: read-side analytics. Pure aggregation over bh_bookings for a date range, bucketed in the
// tenant's timezone (same convention as the Today page). No schema, no writes.
import { db } from "./db";
import * as repo from "./repo";
import type { Booking } from "./types";
import { dateInTz, isoDate, addDays, wallToUtc } from "./engine/tz";

export type DayBucket = { date: string; bookings: number; revenueCents: number; noShows: number };
export type ServiceRow = { id: string; name: string; bookings: number; revenueCents: number };
export type StaffRow = { id: string; name: string; bookings: number };

export type Report = {
  from: string; to: string; // inclusive tenant-tz date strings YYYY-MM-DD
  tz: string;
  totals: { confirmed: number; cancelled: number; noShows: number; noShowRate: number; revenueCents: number };
  byDay: DayBucket[];
  byService: ServiceRow[];
  byStaff: StaffRow[];
  rows: Booking[]; // the underlying confirmed+cancelled bookings in range (for CSV)
};

const MAX_ROWS = 5000; // hard cap so a huge range can't blow up the page / export

/** Parse a YYYY-MM-DD string to {y,m,d}; returns null if malformed. */
function parseDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** Default range: the last 30 days, ending today, in the tenant's tz. */
export function defaultRange(tz: string, nowMs: number): { from: string; to: string } {
  const today = dateInTz(nowMs, tz);
  return { from: isoDate(addDays(today, -29)), to: isoDate(today) };
}

/** Revenue we can attribute to a booking: a paid deposit + any no-show fee actually charged. */
function bookingRevenueCents(b: Booking): number {
  const deposit = b.payment_status === "paid" ? (b.deposit_cents ?? 0) : 0;
  const fee = b.fee_charged_cents ?? 0;
  return deposit + fee;
}

export async function computeReport(tenantId: string, fromStr: string, toStr: string, tz: string): Promise<Report> {
  const from = parseDate(fromStr), to = parseDate(toStr);
  if (!from || !to) throw new Error("bad date range");
  // UTC bounds: [start of `from` day, start of the day AFTER `to`) in the tenant tz.
  const startUtc = wallToUtc({ ...from, hh: 0, mm: 0 }, tz);
  const endUtc = wallToUtc({ ...addDays(to, 1), hh: 0, mm: 0 }, tz);
  if (startUtc == null || endUtc == null) throw new Error("bad tz bounds");

  const { data } = await db().from("bh_bookings").select("*")
    .eq("tenant_id", tenantId)
    .gte("starts_at", new Date(startUtc).toISOString())
    .lt("starts_at", new Date(endUtc).toISOString())
    .order("starts_at")
    .limit(MAX_ROWS);
  const all = (data as Booking[]) ?? [];

  // Build an empty day grid so gaps render as zero (not skipped).
  const byDayMap = new Map<string, DayBucket>();
  for (let d = from; ; d = addDays(d, 1)) {
    const key = isoDate(d);
    byDayMap.set(key, { date: key, bookings: 0, revenueCents: 0, noShows: 0 });
    if (key === toStr) break;
    if (isoDate(d) > toStr) break; // safety
  }

  const [services, staff] = await Promise.all([repo.allServices(tenantId), repo.staffForTenant(tenantId)]);
  const svcName = new Map(services.map((s) => [s.id, s.name] as const));
  const staffName = new Map(staff.map((s) => [s.id, s.name] as const));
  const byService = new Map<string, ServiceRow>();
  const byStaff = new Map<string, StaffRow>();

  let confirmed = 0, cancelled = 0, noShows = 0, revenueCents = 0;
  const rows: Booking[] = [];

  for (const b of all) {
    if (b.status === "declined" || b.status === "pending") continue; // rejected / not-yet-decided don't count
    rows.push(b);
    const dayKey = isoDate(dateInTz(Date.parse(b.starts_at), tz));
    const day = byDayMap.get(dayKey);
    const rev = bookingRevenueCents(b);
    revenueCents += rev;
    if (day) day.revenueCents += rev;

    if (b.status === "cancelled") { cancelled++; continue; }
    // confirmed
    confirmed++;
    if (day) day.bookings++;
    if (b.no_show) { noShows++; if (day) day.noShows++; }

    const sr = byService.get(b.service_id) ?? { id: b.service_id, name: svcName.get(b.service_id) ?? "Service", bookings: 0, revenueCents: 0 };
    sr.bookings++; sr.revenueCents += rev; byService.set(b.service_id, sr);
    const st = byStaff.get(b.staff_id) ?? { id: b.staff_id, name: staffName.get(b.staff_id) ?? "Staff", bookings: 0 };
    st.bookings++; byStaff.set(b.staff_id, st);
  }

  return {
    from: fromStr, to: toStr, tz,
    totals: { confirmed, cancelled, noShows, noShowRate: confirmed > 0 ? noShows / confirmed : 0, revenueCents },
    byDay: [...byDayMap.values()],
    byService: [...byService.values()].sort((a, b) => b.bookings - a.bookings),
    byStaff: [...byStaff.values()].sort((a, b) => b.bookings - a.bookings),
    rows,
  };
}
