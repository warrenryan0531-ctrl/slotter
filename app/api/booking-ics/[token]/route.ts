import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { buildIcs } from "@/lib/ics";
import { ORGANIZER_EMAIL } from "@/lib/brand";

/** Direct .ics download for a booking (confirmation page "Add to calendar"). */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const b = await repo.bookingByManageToken(token);
  if (!b) return new NextResponse("Not found", { status: 404 });
  const tenant = await repo.tenantById(b.tenant_id);
  const service = await repo.serviceById(b.service_id);
  if (!tenant || !service) return new NextResponse("Not found", { status: 404 });
  const ics = buildIcs({
    uid: b.ics_uid, sequence: b.ics_sequence,
    method: b.status === "cancelled" ? "CANCEL" : "REQUEST",
    start: Date.parse(b.starts_at), end: Date.parse(b.ends_at),
    summary: `${service.name} — ${tenant.name}`,
    description: `Booked via ${tenant.name}.`,
    location: b.address?.line,
    organizerName: tenant.name, organizerEmail: ORGANIZER_EMAIL,
    attendees: [{ name: b.customer.name, email: b.customer.email }],
    stampNow: Date.now(),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="booking.ics"`,
    },
  });
}
