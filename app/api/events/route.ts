import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { rateLimit, ipOf } from "@/lib/ratelimit";

/** List upcoming events (with seats remaining) for a group service. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const slug = url.searchParams.get("slug") ?? "";
  const serviceId = url.searchParams.get("service") ?? "";
  if (!(await rateLimit(`events:${ipOf(req)}`, 60, 120))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const tenant = await repo.tenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const service = await repo.serviceById(serviceId);
  if (!service || service.tenant_id !== tenant.id || !service.active || !service.is_group) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const events = await repo.eventsWithSeats(service.id);
  return NextResponse.json({
    tz: tenant.tz,
    events: events.map((e) => ({ id: e.id, start: Date.parse(e.starts_at), end: Date.parse(e.ends_at), seatsLeft: e.seats_left, capacity: e.capacity })),
  });
}
