import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { rateLimit, ipOf } from "@/lib/ratelimit";

// Join a full class's waitlist (E4). When a seat frees up, bh_promote_waitlist auto-enrolls the
// next person and they get a confirmation email.
export async function POST(req: Request) {
  if (!(await rateLimit(`waitlist:${ipOf(req)}`, 300, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as
    | { slug?: string; eventId?: string; customer?: { name?: string; phone?: string; email?: string }; smsConsent?: boolean }
    | null;
  if (!body?.slug || !body.eventId || !body.customer?.name || !body.customer?.email) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const tenant = await repo.tenantBySlug(body.slug);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data, error } = await db().rpc("bh_join_waitlist", {
    p_event_id: body.eventId,
    p_customer: { name: body.customer.name, phone: body.customer.phone ?? "", email: body.customer.email },
    p_sms_consent: Boolean(body.smsConsent),
  });
  if (error) return NextResponse.json({ error: "failed" }, { status: 400 });
  return NextResponse.json({ ok: true, id: data });
}
