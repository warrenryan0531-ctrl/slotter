import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { slotInputFor } from "@/lib/booking";
import { generateSlots } from "@/lib/engine/slots";
import { rateLimit, ipOf } from "@/lib/ratelimit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const serviceId = url.searchParams.get("service") ?? "";
  const staffId = url.searchParams.get("staff") ?? "";
  if (!(await rateLimit(`slots:${ipOf(req)}`, 60, 120))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const tenant = await repo.tenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const service = await repo.serviceById(serviceId);
  if (!service || service.tenant_id !== tenant.id || !service.active) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const staff = await repo.staffForService(service.id);
  const chosen = staff.find((s) => s.id === staffId);
  if (!chosen) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const inp = await slotInputFor(tenant, service, chosen.id, Date.now());
  const slots = generateSlots(inp);
  return NextResponse.json({ tz: tenant.tz, slots: slots.map((s) => s.start) });
}
