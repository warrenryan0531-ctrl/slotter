import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { buildFeed } from "@/lib/ics";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const tenant = await repo.tenantByIcsToken(token);
  if (!tenant) return new NextResponse("Not found", { status: 404 });
  const from = new Date(Date.now() - 60 * 86400000).toISOString();
  const bookings = (await repo.bookingsForTenant(tenant.id, from)).filter((b) => b.status === "confirmed");
  const services = await repo.allServices(tenant.id);
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? "Appointment";
  const feed = buildFeed(`${tenant.name} — Bookings`, bookings.map((b) => ({
    uid: b.ics_uid, sequence: b.ics_sequence, stampNow: Date.parse(b.created_at),
    start: Date.parse(b.starts_at), end: Date.parse(b.ends_at),
    summary: `${svcName(b.service_id)} — ${b.customer.name}`,
    description: `${b.customer.phone} · ${b.customer.email}`,
    location: b.address?.line,
  })));
  return new NextResponse(feed, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${tenant.slug}-bookings.ics"`,
    },
  });
}
