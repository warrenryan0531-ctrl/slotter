import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

// Public, no-login demo. Hitting /demo lands you straight on a fully-populated OWNER dashboard for a
// fixed sample business ("Coastal Cuts Barbershop") — no email code, no password. It re-seeds a fresh
// day of bookings on every visit so the demo is always pristine and can't be broken by a prospect.
// Scoped entirely to the hardcoded sample tenant below; it can never touch a real business.
export const dynamic = "force-dynamic";

const SLUG = "coastal-cuts";
const OWNER_EMAIL = "sam@coastalcuts.demo";
const BRAND = "#1f3d5c";

type Svc = { id: string; name: string; duration_min: number };

async function ensureDemoTenant(): Promise<{ tenantId: string; staffId: string; svcs: Svc[] }> {
  const d = db();
  const existing = await d.from("bh_tenants").select("id").eq("slug", SLUG).limit(1);
  let tenantId = (existing.data?.[0] as { id?: string } | undefined)?.id;

  if (!tenantId) {
    const { data: tid } = await d.rpc("bh_create_tenant", {
      p_slug: SLUG, p_name: "Coastal Cuts Barbershop", p_tz: "America/New_York",
      p_owner_name: "Sam Rivera", p_owner_email: OWNER_EMAIL,
    });
    tenantId = tid as string;
    await d.from("bh_tenants").update({ branding: { color: BRAND } }).eq("id", tenantId);
    const staffRow = await d.from("bh_staff").select("id").eq("tenant_id", tenantId).limit(1);
    const staffId = (staffRow.data?.[0] as { id: string }).id;
    const mkSvc = async (name: string, desc: string, dur: number, price: number, sort: number) => {
      const { data } = await d.rpc("bh_upsert_service", {
        p_tenant_id: tenantId, p_id: null, p_name: name, p_description: desc, p_duration_min: dur,
        p_buffer_before_min: 0, p_buffer_after_min: 5, p_price_cents: price, p_kind: "appointment",
        p_location_mode: "business", p_booking_mode: "instant", p_deposit_cents: null,
        p_requires_payment: false, p_is_group: false, p_capacity: 1, p_active: true, p_sort: sort,
      });
      return data as string;
    };
    const ids = [
      await mkSvc("Haircut", "Classic cut, hot-towel finish & style.", 30, 3500, 0),
      await mkSvc("Beard Trim", "Shape-up, line & condition.", 15, 2000, 1),
      await mkSvc("Cut + Beard", "The full reset — haircut and beard together.", 45, 5000, 2),
    ];
    for (const sid of ids) await d.rpc("bh_assign_service_staff", { p_tenant_id: tenantId, p_service_id: sid, p_staff_ids: [staffId] });
  }

  const staff = await d.from("bh_staff").select("id").eq("tenant_id", tenantId).eq("is_owner", true).limit(1);
  const staffId = (staff.data?.[0] as { id: string }).id;
  const svcRows = await d.from("bh_services").select("id, name, duration_min").eq("tenant_id", tenantId).order("sort");
  return { tenantId, staffId, svcs: (svcRows.data as Svc[]) ?? [] };
}

async function reseedBookings(tenantId: string, staffId: string, svcs: Svc[]) {
  const d = db();
  await d.from("bh_bookings").delete().eq("tenant_id", tenantId);
  if (svcs.length < 3) return;
  const byName = (n: string) => svcs.find((s) => s.name === n) ?? svcs[0];
  const now = Date.now();
  // Two later today (so "Booked today" reads 2), three across the next few days.
  const plan: { svc: Svc; offMin: number; cust: { name: string; phone: string; email: string } }[] = [
    { svc: byName("Haircut"), offMin: 75, cust: { name: "Marcus Bell", phone: "+19045550111", email: "marcus@example.com" } },
    { svc: byName("Beard Trim"), offMin: 150, cust: { name: "Devon Price", phone: "+19045550122", email: "devon@example.com" } },
    { svc: byName("Cut + Beard"), offMin: 24 * 60, cust: { name: "Andre Watson", phone: "+19045550133", email: "andre@example.com" } },
    { svc: byName("Haircut"), offMin: 27 * 60, cust: { name: "Chris Nolan", phone: "+19045550144", email: "chris@example.com" } },
    { svc: byName("Haircut"), offMin: 72 * 60, cust: { name: "Tyler Brooks", phone: "+19045550155", email: "tyler@example.com" } },
  ];
  for (const b of plan) {
    const start = new Date(now + b.offMin * 60000);
    const end = new Date(start.getTime() + b.svc.duration_min * 60000);
    await d.rpc("bh_insert_booking", {
      p_tenant_id: tenantId, p_service_id: b.svc.id, p_staff_id: staffId, p_customer: b.cust,
      p_intake: {}, p_address: null, p_starts_at: start.toISOString(), p_ends_at: end.toISOString(),
      p_buf_before: 0, p_buf_after: 5, p_sms_consent: false, p_manage_token: randomUUID(), p_ics_uid: randomUUID(),
    });
  }
}

export async function GET(req: Request) {
  try {
    const { tenantId, staffId, svcs } = await ensureDemoTenant();
    await reseedBookings(tenantId, staffId, svcs);
    await createSession({ email: OWNER_EMAIL, role: "owner", tenantId });
  } catch (e) {
    console.error("[demo] setup failed:", (e as Error).message);
  }
  return NextResponse.redirect(new URL("/dashboard", req.url));
}
