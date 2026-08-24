import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { createBooking, registerForEvent, startPaidBooking } from "@/lib/booking";
import { rateLimit, ipOf } from "@/lib/ratelimit";
import { intakeQuestions } from "@/lib/repo";

export async function POST(req: Request) {
  if (!(await rateLimit(`book:${ipOf(req)}`, 300, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const slug = String(body.slug ?? "");
  const serviceId = String(body.serviceId ?? "");
  const staffId = String(body.staffId ?? "");
  const start = Number(body.start ?? 0);
  const customer = body.customer as { name?: string; phone?: string; email?: string } | undefined;
  const intake = (body.intake ?? {}) as Record<string, string>;
  const addressLine = typeof body.address === "string" ? body.address.trim() : "";
  const smsConsent = Boolean(body.smsConsent);

  const eventId = typeof body.eventId === "string" ? body.eventId : "";

  if (!customer?.name?.trim() || !customer?.phone?.trim() || !customer?.email?.trim() || !/.+@.+\..+/.test(customer.email)) {
    return NextResponse.json({ error: "invalid_customer" }, { status: 400 });
  }

  const cleanCustomer = { name: customer.name.trim().slice(0, 120), phone: customer.phone.trim().slice(0, 40), email: customer.email.trim().slice(0, 200) };

  // Ownership chain: tenant by slug → service belongs to tenant.
  const tenant = await repo.tenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const service = await repo.serviceById(serviceId);
  if (!service || service.tenant_id !== tenant.id || !service.active) {
    return NextResponse.json({ error: "invalid_service" }, { status: 400 });
  }

  // ---- Version 4: group-class event registration ----
  if (service.is_group) {
    if (!eventId) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
    const ev = await repo.eventById(eventId);
    if (!ev || ev.service_id !== service.id || !ev.active) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
    const questions = await intakeQuestions(service.id);
    const gIntake: Record<string, string> = {};
    for (const q of questions) {
      const v = (intake[q.id] ?? "").toString().trim();
      if (q.required && !v) return NextResponse.json({ error: "intake_required", label: q.label }, { status: 400 });
      if (v) gIntake[q.label] = v.slice(0, 1000);
    }
    const reg = await registerForEvent({ tenant, service, eventId, customer: cleanCustomer, intake: gIntake, smsConsent });
    if (!reg.ok) {
      const status = reg.reason === "full" ? 409 : 400;
      return NextResponse.json({ error: reg.reason }, { status });
    }
    return NextResponse.json({ ok: true, manageToken: reg.booking.manage_token, pending: reg.pending, seatsLeft: reg.seatsLeft, group: true });
  }

  if (!Number.isFinite(start) || start <= 0) return NextResponse.json({ error: "invalid_start" }, { status: 400 });
  const staffList = await repo.staffForService(service.id);
  const staff = staffList.find((s) => s.id === staffId);
  if (!staff) return NextResponse.json({ error: "invalid_staff" }, { status: 400 });

  if (service.location_mode === "address" && !addressLine) {
    return NextResponse.json({ error: "address_required" }, { status: 400 });
  }
  const questions = await intakeQuestions(service.id);
  const cleanIntake: Record<string, string> = {};
  for (const q of questions) {
    const v = (intake[q.id] ?? "").toString().trim();
    if (q.required && !v) return NextResponse.json({ error: "intake_required", label: q.label }, { status: 400 });
    if (v) cleanIntake[q.label] = v.slice(0, 1000);
  }

  const cleanAddress = addressLine ? { line: addressLine.slice(0, 300) } : null;

  // ---- Version 3: paid booking + deposit (payment is the gate; overrides request-mode) ----
  if (service.requires_payment && (service.deposit_cents ?? 0) > 0) {
    const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
    const paid = await startPaidBooking({
      tenant, service, staff, startUtc: start, customer: cleanCustomer,
      intake: cleanIntake, address: cleanAddress, smsConsent, baseUrl: base,
    });
    if (!paid.ok) {
      const status = paid.reason === "conflict" ? 409 : 400;
      return NextResponse.json({ error: paid.reason }, { status });
    }
    return NextResponse.json({ ok: true, manageToken: paid.booking.manage_token, paymentUrl: paid.paymentUrl, paid: true });
  }

  const result = await createBooking({
    tenant, service, staff, startUtc: start,
    customer: cleanCustomer,
    intake: cleanIntake,
    address: cleanAddress,
    smsConsent,
  });
  if (!result.ok) {
    const status = result.reason === "conflict" ? 409 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, manageToken: result.booking.manage_token, pending: result.pending });
}
