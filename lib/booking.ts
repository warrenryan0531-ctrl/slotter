// Booking orchestration: server-side validation contract (resolution #2) + notifications.
import { db } from "./db";
import { getServices } from "./services";
import { newToken } from "./auth";
import { buildIcs } from "./ics";
import { generateSlots, type SlotInput } from "./engine/slots";
import { fmtInTz, isoDate, dateInTz } from "./engine/tz";
import * as repo from "./repo";
import { APP_NAME, ICS_DOMAIN, ORGANIZER_EMAIL } from "./brand";
import { externalBusyForStaff, syncBookingToCalendars, ownerCalendarSyncs } from "./calendar";
import { captureError } from "./observe";
import { tenantSettings, type Booking, type Service, type Tenant, type Staff } from "./types";

export async function slotInputFor(tenant: Tenant, service: Service, staffId: string, now: number): Promise<SlotInput> {
  const s = tenantSettings(tenant);
  const fromIso = new Date(now - 86400000).toISOString();
  const fromDate = isoDate(dateInTz(now, tenant.tz));
  const toMs = now + (s.maxAdvanceDays + 1) * 86400000;
  const [rules, overrides, blocks, bookings, external] = await Promise.all([
    repo.rulesForStaff(staffId),
    repo.overridesForStaff(staffId, fromDate),
    repo.blocksForStaff(staffId, fromIso),
    repo.heldBookingsForStaff(staffId, fromIso), // confirmed + pending both hold the slot
    // E1: the owner's real calendar busy times block slots too (two-way sync).
    externalBusyForStaff(tenant.tz, staffId, now, now - 86400000, toMs),
  ]);
  return {
    tz: tenant.tz, now,
    rangeDays: s.maxAdvanceDays,
    durationMin: service.duration_min,
    bufferBeforeMin: service.buffer_before_min,
    bufferAfterMin: service.buffer_after_min,
    granularityMin: s.granularityMin,
    minNoticeHours: s.minNoticeHours,
    maxAdvanceDays: s.maxAdvanceDays,
    rules, overrides,
    busy: [
      ...blocks.map((b) => ({ start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) })),
      ...bookings.map((b) => ({
        start: Date.parse(b.starts_at) - b.buffer_before_min * 60000,
        end: Date.parse(b.ends_at) + b.buffer_after_min * 60000,
      })),
      ...external, // owner's external-calendar busy (already self-filtered, R3)
    ],
  };
}

export type BookResult = { ok: true; booking: Booking; pending: boolean } | { ok: false; reason: "conflict" | "invalid" };

export async function createBooking(args: {
  tenant: Tenant; service: Service; staff: Staff;
  startUtc: number;
  customer: { name: string; phone: string; email: string };
  intake: Record<string, string>;
  address: { line: string } | null;
  smsConsent: boolean;
}): Promise<BookResult> {
  const { tenant, service, staff } = args;
  const now = Date.now();
  const inp = await slotInputFor(tenant, service, staff.id, now);
  const valid = generateSlots(inp).some((sl) => sl.start === args.startUtc);
  if (!valid) return { ok: false, reason: "invalid" };

  const endUtc = args.startUtc + service.duration_min * 60000;
  const manageToken = newToken();
  const icsUid = `${newToken()}@${ICS_DOMAIN}`;
  const pending = service.booking_mode === "request";
  const { data, error } = await db().rpc("bh_insert_booking", {
    p_tenant_id: tenant.id, p_service_id: service.id, p_staff_id: staff.id,
    p_customer: args.customer, p_intake: args.intake, p_address: args.address,
    p_starts_at: new Date(args.startUtc).toISOString(), p_ends_at: new Date(endUtc).toISOString(),
    p_buf_before: service.buffer_before_min, p_buf_after: service.buffer_after_min,
    p_sms_consent: args.smsConsent, p_manage_token: manageToken, p_ics_uid: icsUid,
    p_status: pending ? "pending" : "confirmed",
  });
  if (error) {
    if (error.message.includes("BH_BLOCKED")) return { ok: false, reason: "conflict" };
    throw new Error(`booking insert failed: ${error.message}`);
  }
  const res = data as { ok: boolean; reason?: string; id?: string };
  if (!res.ok) return { ok: false, reason: "conflict" };
  const booking = await repo.bookingById(res.id!);
  if (!booking) throw new Error("booking vanished after insert");
  await notifyBooking(tenant, service, staff, booking, pending ? "requested" : "created");
  return { ok: true, booking, pending };
}

export type PaidStartResult = { ok: true; booking: Booking; paymentUrl: string } | { ok: false; reason: "conflict" | "invalid" };

/** Start a paid booking: create a PENDING/awaiting hold (holds the slot), then a checkout the
 *  customer is redirected to. Confirmed later by markBookingPaid on payment success. */
export async function startPaidBooking(args: {
  tenant: Tenant; service: Service; staff: Staff; startUtc: number;
  customer: { name: string; phone: string; email: string };
  intake: Record<string, string>; address: { line: string } | null; smsConsent: boolean; baseUrl: string;
}): Promise<PaidStartResult> {
  const { tenant, service, staff } = args;
  const now = Date.now();
  const inp = await slotInputFor(tenant, service, staff.id, now);
  if (!generateSlots(inp).some((sl) => sl.start === args.startUtc)) return { ok: false, reason: "invalid" };
  const endUtc = args.startUtc + service.duration_min * 60000;
  const manageToken = newToken();
  const icsUid = `${newToken()}@${ICS_DOMAIN}`;
  // Pay-in-full charges the whole price; deposit mode charges the deposit (E4).
  const amount = service.pay_mode === "full" ? (service.price_cents ?? service.deposit_cents ?? 0) : (service.deposit_cents ?? 0);
  const { data, error } = await db().rpc("bh_insert_booking", {
    p_tenant_id: tenant.id, p_service_id: service.id, p_staff_id: staff.id,
    p_customer: args.customer, p_intake: args.intake, p_address: args.address,
    p_starts_at: new Date(args.startUtc).toISOString(), p_ends_at: new Date(endUtc).toISOString(),
    p_buf_before: service.buffer_before_min, p_buf_after: service.buffer_after_min,
    p_sms_consent: args.smsConsent, p_manage_token: manageToken, p_ics_uid: icsUid,
    p_status: "pending", p_payment_status: "awaiting", p_deposit_cents: amount,
  });
  if (error) {
    if (error.message.includes("BH_BLOCKED")) return { ok: false, reason: "conflict" };
    throw new Error(`paid booking insert failed: ${error.message}`);
  }
  const res = data as { ok: boolean; reason?: string; id?: string };
  if (!res.ok) return { ok: false, reason: "conflict" };
  const booking = await repo.bookingById(res.id!);
  if (!booking) throw new Error("booking vanished after insert");
  const { pay } = getServices();
  const { url } = await pay.createCheckout({ tenant, service, booking, amountCents: amount, baseUrl: args.baseUrl });
  return { ok: true, booking, paymentUrl: url };
}

/** Confirm a paid booking after payment. Idempotent — notifies only on the first transition. */
export async function markBookingPaid(bookingId: string, ref?: string): Promise<{ ok: boolean; transitioned: boolean }> {
  const { data, error } = await db().rpc("bh_mark_paid", { p_booking_id: bookingId, p_ref: ref ?? null });
  if (error) throw new Error(`mark paid failed: ${error.message}`);
  const res = data as { ok: boolean; transitioned: boolean };
  if (res.transitioned) {
    const booking = await repo.bookingById(bookingId);
    if (booking) {
      const tenant = await repo.tenantById(booking.tenant_id);
      const service = await repo.serviceById(booking.service_id);
      const staff = (await repo.staffForTenant(booking.tenant_id)).find((s) => s.id === booking.staff_id)!;
      if (tenant && service) await notifyBooking(tenant, service, staff, booking, "created");
    }
  }
  return res;
}

export type RegisterResult = { ok: true; booking: Booking; pending: boolean; seatsLeft: number } | { ok: false; reason: "full" | "not_found" | "past" };

/** Register a customer for a group-class event (V4). Capacity enforced atomically in the RPC. */
export async function registerForEvent(args: {
  tenant: Tenant; service: Service; eventId: string;
  customer: { name: string; phone: string; email: string };
  intake: Record<string, string>; smsConsent: boolean;
}): Promise<RegisterResult> {
  const pending = args.service.booking_mode === "request";
  const manageToken = newToken();
  const icsUid = `${newToken()}@${ICS_DOMAIN}`;
  const { data, error } = await db().rpc("bh_register_event", {
    p_event_id: args.eventId, p_customer: args.customer, p_intake: args.intake,
    p_sms_consent: args.smsConsent, p_manage_token: manageToken, p_ics_uid: icsUid,
    p_status: pending ? "pending" : "confirmed",
  });
  if (error) throw new Error(`register failed: ${error.message}`);
  const res = data as { ok: boolean; reason?: string; id?: string; seats_left?: number };
  if (!res.ok) return { ok: false, reason: (res.reason as "full" | "not_found" | "past") ?? "not_found" };
  const booking = await repo.bookingById(res.id!);
  if (!booking) throw new Error("registration vanished after insert");
  const staff = (await repo.staffForTenant(args.tenant.id)).find((s) => s.id === booking.staff_id)!;
  await notifyBooking(args.tenant, args.service, staff, booking, pending ? "requested" : "created");
  return { ok: true, booking, pending, seatsLeft: res.seats_left ?? 0 };
}

/** Reminder email to the customer (only). kind is a label like "24h" / "1h". Idempotency is
 *  handled by the caller (bh_claim_reminder). Works for both 1:1 and group registrations. */
export async function sendReminder(tenant: Tenant, service: Service, booking: Booking, kind: string): Promise<void> {
  const { mail, sms } = getServices();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const when = describeWhen(booking, tenant.tz);
  const owner = await repo.ownerEmail(tenant.id);
  const color = tenant.branding.color ?? "#0f62fe";
  const hoursOut = Math.round((Date.parse(booking.starts_at) - Date.now()) / 3600000);
  const lead = kind === "1h" || hoursOut <= 2 ? "soon" : hoursOut <= 26 ? "tomorrow" : "coming up";
  const ics = buildIcs({
    uid: booking.ics_uid, sequence: booking.ics_sequence, method: "REQUEST",
    start: Date.parse(booking.starts_at), end: Date.parse(booking.ends_at),
    summary: `${service.name} — ${tenant.name}`,
    description: `Reminder. Manage: ${base}/manage/${booking.manage_token}`,
    location: service.location_mode === "address" ? booking.address?.line : service.location_mode === "phone" ? `Phone: ${booking.customer.phone}` : undefined,
    organizerName: tenant.name, organizerEmail: ORGANIZER_EMAIL,
    attendees: [{ name: booking.customer.name, email: booking.customer.email }],
    stampNow: Date.now(),
  });
  await mail.send({
    tenantId: tenant.id, to: booking.customer.email,
    subject: `Reminder: ${service.name} ${lead === "tomorrow" ? "tomorrow" : lead === "soon" ? "soon" : ""} — ${when}`.replace(/\s+—/, " —"),
    fromName: tenant.name, replyTo: owner ?? undefined,
    html: `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
      <div style="background:${color};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><strong>${tenant.name}</strong></div>
      <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 12px 12px">
        <h2 style="margin:0 0 8px">Reminder — your ${service.is_group ? "class" : "appointment"} is ${lead}</h2>
        <p style="margin:4px 0"><strong>${service.name}</strong> — ${when}</p>
        ${booking.address ? `<p style="margin:4px 0">Address: ${booking.address.line}</p>` : ""}
        <p style="margin:8px 0"><a href="${base}/manage/${booking.manage_token}">Need to change it?</a></p>
        <p style="color:#6b7280;font-size:12px;margin-top:12px">See you ${lead}!</p>
      </div>
    </div>`,
    ics: { text: ics, method: "REQUEST" },
  });
  // E2: SMS reminder alongside the email, same consent/provider gating.
  if (sms.enabled && booking.sms_consent && booking.customer.phone && tenantSettings(tenant).smsEnabled) {
    try {
      await sms.send({ tenantId: tenant.id, to: booking.customer.phone, body: `${tenant.name} reminder: ${service.name} ${lead} — ${when}. Manage: ${base}/manage/${booking.manage_token}` });
    } catch (e) { console.error("[sms] reminder failed:", (e as Error).message); }
  }
}

/** Owner approves or declines a pending request. */
export async function decideBooking(bookingId: string, decision: "approve" | "decline", actor: "owner" | "admin"): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await db().rpc("bh_decide_booking", { p_booking_id: bookingId, p_decision: decision, p_actor: actor });
  if (error) throw new Error(`decide failed: ${error.message}`);
  const res = data as { ok: boolean; reason?: string };
  if (!res.ok) return res;
  const booking = await repo.bookingById(bookingId);
  if (booking) {
    const tenant = await repo.tenantById(booking.tenant_id);
    const service = await repo.serviceById(booking.service_id);
    const staff = (await repo.staffForTenant(booking.tenant_id)).find((s) => s.id === booking.staff_id);
    if (tenant && service) await notifyBooking(tenant, service, staff!, booking, decision === "approve" ? "approved" : "declined");
  }
  return res;
}

/** Refund a paid booking (E4/R2). Atomic transition in the DB; Stripe called only on first
 *  transition, with an idempotency key so retries never double-refund. Best-effort on the provider
 *  call — the DB state is the source of truth and a failed provider call is logged for retry. */
export async function refundBooking(bookingId: string): Promise<{ transitioned: boolean; amountCents: number }> {
  const { data, error } = await db().rpc("bh_refund_booking", { p_booking_id: bookingId, p_amount_cents: null });
  if (error) throw new Error(`refund failed: ${error.message}`);
  const res = data as { transitioned: boolean; amount_cents?: number };
  if (!res.transitioned) return { transitioned: false, amountCents: 0 };
  const amountCents = res.amount_cents ?? 0;
  try {
    const booking = await repo.bookingById(bookingId);
    const tenant = booking && await repo.tenantById(booking.tenant_id);
    if (booking && tenant) {
      const { pay } = getServices();
      await pay.refund({ tenant, booking, amountCents, idempotencyKey: `${bookingId}:refund` });
    }
  } catch (e) {
    // Money-critical: DB says refunded but the provider call failed → alert loudly for retry.
    captureError("refund.provider_failed", e, { bookingId, amountCents, needsManualRetry: true });
  }
  return { transitioned: true, amountCents };
}

/** After a group-class seat frees up, auto-promote the next waitlister (atomic) and notify them. */
export async function promoteWaitlist(eventId: string): Promise<void> {
  const { data, error } = await db().rpc("bh_promote_waitlist", { p_event_id: eventId });
  if (error) { console.error("[waitlist] promote failed:", error.message); return; }
  const res = data as { promoted: boolean; booking_id?: string };
  if (!res.promoted || !res.booking_id) return;
  const booking = await repo.bookingById(res.booking_id);
  if (!booking) return;
  const tenant = await repo.tenantById(booking.tenant_id);
  const service = await repo.serviceById(booking.service_id);
  const staff = (await repo.staffForTenant(booking.tenant_id)).find((s) => s.id === booking.staff_id);
  if (tenant && service) await notifyBooking(tenant, service, staff!, booking, "approved"); // "you're in!" confirmation
}

/** Owner marks (or clears) a no-show. */
export async function markNoShow(tenantId: string, bookingId: string, value: boolean): Promise<boolean> {
  const { data, error } = await db().rpc("bh_mark_no_show", { p_tenant_id: tenantId, p_booking_id: bookingId, p_value: value });
  if (error) throw new Error(`no-show failed: ${error.message}`);
  return Boolean(data);
}

export function describeWhen(b: Pick<Booking, "starts_at" | "ends_at">, tz: string): string {
  const start = Date.parse(b.starts_at);
  return `${fmtInTz(start, tz, { weekday: "long", month: "long", day: "numeric" })} at ${fmtInTz(start, tz, { hour: "numeric", minute: "2-digit" })}`;
}

function locationOf(service: Service, booking: Booking): string | undefined {
  if (service.location_mode === "address") return booking.address?.line ?? "Customer address";
  if (service.location_mode === "phone") return `Phone: ${booking.customer.phone}`;
  return undefined;
}

type NotifyKind = "created" | "requested" | "approved" | "declined" | "rescheduled" | "cancelled";

export async function notifyBooking(tenant: Tenant, service: Service, staff: Staff, booking: Booking, kind: NotifyKind): Promise<void> {
  const { mail, sms } = getServices();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const when = describeWhen(booking, tenant.tz);
  const owner = await repo.ownerEmail(tenant.id);
  const color = tenant.branding.color ?? "#0f62fe";

  // If the owner's calendar receives booking write-backs via the provider API (Google/Outlook
  // sync), we must NOT also invite the owner as an .ics attendee or attach the invite to their
  // own notice — their calendar client would auto-add a SECOND, duplicate copy of the event.
  const ownerSynced = !!staff && !service.is_group && !!owner && (await ownerCalendarSyncs(staff.id));

  // .ics only attaches when there's a real calendar event to add/remove: confirmed states + cancels.
  // A pending "request received" carries no invite (nothing is on the calendar yet).
  const attachIcs = kind === "created" || kind === "approved" || kind === "rescheduled" || kind === "cancelled";
  const method = kind === "cancelled" ? ("CANCEL" as const) : ("REQUEST" as const);
  const ics = attachIcs ? buildIcs({
    uid: booking.ics_uid, sequence: booking.ics_sequence, method,
    start: Date.parse(booking.starts_at), end: Date.parse(booking.ends_at),
    summary: `${service.name} — ${booking.customer.name} (${tenant.name})`,
    description: `Booked via ${tenant.name}. Manage: ${base}/manage/${booking.manage_token}`,
    location: locationOf(service, booking),
    organizerName: tenant.name, organizerEmail: ORGANIZER_EMAIL,
    attendees: [
      ...(owner && !ownerSynced ? [{ name: `${tenant.name} (owner)`, email: owner }] : []),
      { name: booking.customer.name, email: booking.customer.email },
    ],
    stampNow: Date.now(),
  }) : null;

  // E1: two-way calendar sync (best-effort; never blocks the email). Group registrations are
  // excluded — the class is the calendar event, not each seat. Awaited so it completes before
  // the serverless function returns (fire-and-forget can be killed mid-flight).
  if (staff && !service.is_group) {
    if (kind === "cancelled" || kind === "declined") {
      await syncBookingToCalendars(staff.id, booking.id, "delete");
    } else if (kind === "created" || kind === "approved" || kind === "rescheduled") {
      await syncBookingToCalendars(staff.id, booking.id, "upsert", {
        bookingId: booking.id,
        title: `${service.name} — ${booking.customer.name}`,
        description: `Booked via ${tenant.name}. Manage: ${base}/manage/${booking.manage_token}`,
        location: locationOf(service, booking),
        start: Date.parse(booking.starts_at),
        end: Date.parse(booking.ends_at),
      });
    }
  }

  const card = (title: string, extra: string, note?: string) => `
  <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto">
    <div style="background:${color};color:#fff;padding:16px 20px;border-radius:12px 12px 0 0"><strong>${tenant.name}</strong></div>
    <div style="border:1px solid #e5e7eb;border-top:0;padding:20px;border-radius:0 0 12px 12px">
      <h2 style="margin:0 0 8px">${title}</h2>
      <p style="margin:4px 0"><strong>${service.name}</strong> — ${when}</p>
      ${extra}
      ${note ?? (ics ? `<p style="color:#6b7280;font-size:12px;margin-top:16px">A calendar invite (.ics) is attached — open it to add this to Google, Outlook, Apple, or Yahoo calendar.</p>` : "")}
    </div>
  </div>`;

  const custDetails = `<p style="margin:4px 0">${booking.customer.name} — <a href="tel:${booking.customer.phone}">${booking.customer.phone}</a> — ${booking.customer.email}</p>
    ${booking.address ? `<p style="margin:4px 0">Address: ${booking.address.line}</p>` : ""}
    ${Object.entries(booking.intake_answers).map(([k, v]) => `<p style="margin:2px 0;color:#374151"><em>${k}:</em> ${v}</p>`).join("")}
    ${staff ? `<p style="margin:4px 0;color:#6b7280">Assigned to: ${staff.name}</p>` : ""}`;
  const manageLink = `<p style="margin:4px 0">Need to change it? <a href="${base}/manage/${booking.manage_token}">Reschedule or cancel</a></p>`;

  // ---- customer email ----
  const cust: Record<NotifyKind, { subject: string; title: string; extra: string; note?: string }> = {
    requested: { subject: `Request received: ${service.name} — ${when}`, title: "We got your request", extra: `<p style="margin:4px 0;color:#374151">${tenant.name} will confirm shortly. You'll get an email the moment they do — nothing's locked until then.</p>`, note: " " },
    approved: { subject: `Confirmed: ${service.name} — ${when}`, title: "You're confirmed!", extra: manageLink },
    created: { subject: `Confirmed: ${service.name} — ${when}`, title: "Your booking is confirmed", extra: manageLink },
    rescheduled: { subject: `Rescheduled: ${service.name} — ${when}`, title: "Your booking was rescheduled", extra: manageLink },
    cancelled: { subject: `Cancelled: ${service.name} — ${when}`, title: "Your booking was cancelled", extra: "" },
    declined: { subject: `Update on your request: ${service.name}`, title: "Sorry — we couldn't fit that time", extra: `<p style="margin:4px 0;color:#374151">${tenant.name} isn't able to take that slot. Please pick another time: <a href="${base}/b/${tenant.slug}">book again</a>.</p>`, note: " " },
  };
  const c = cust[kind];
  await mail.send({
    tenantId: tenant.id, to: booking.customer.email, subject: c.subject,
    fromName: tenant.name, replyTo: owner ?? undefined,
    html: card(c.title, c.extra, c.note),
    ...(ics ? { ics: { text: ics, method } } : {}),
  });

  // ---- customer SMS (E2) — only with consent + a phone, and only for meaningful events. ----
  if (sms.enabled && booking.sms_consent && booking.customer.phone && tenantSettings(tenant).smsEnabled) {
    const smsText: Partial<Record<NotifyKind, string>> = {
      requested: `${tenant.name}: request received for ${service.name} on ${when}. We'll confirm shortly.`,
      approved: `${tenant.name}: you're confirmed for ${service.name} on ${when}.`,
      created: `${tenant.name}: booking confirmed — ${service.name} on ${when}.`,
      rescheduled: `${tenant.name}: rescheduled — ${service.name} is now ${when}.`,
      cancelled: `${tenant.name}: your ${service.name} booking on ${when} was cancelled.`,
      declined: `${tenant.name}: sorry, we couldn't take ${when}. Please pick another time: ${base}/b/${tenant.slug}`,
    };
    const body = smsText[kind];
    if (body) { try { await sms.send({ tenantId: tenant.id, to: booking.customer.phone, body }); } catch (e) { console.error("[sms] send failed:", (e as Error).message); } }
  }

  // ---- owner notice (skip on 'approved'/'declined' — the owner is the one who acted) ----
  if (owner && kind !== "approved" && kind !== "declined") {
    const ownerHead: Record<string, { subj: string; title: string; note?: string }> = {
      requested: { subj: `🟡 Booking REQUEST — approve/decline: ${service.name} — ${when}`, title: "New booking request — needs your OK", note: `<p style="margin:8px 0"><a href="${base}/dashboard" style="display:inline-block;background:${color};color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none">Approve or decline →</a></p>` },
      created: { subj: `✅ New booking: ${service.name} — ${when}`, title: "You have a new booking" },
      rescheduled: { subj: `🔁 Rescheduled: ${service.name} — ${when}`, title: "Booking rescheduled" },
      cancelled: { subj: `❌ Cancelled: ${service.name} — ${when}`, title: "Booking cancelled" },
    };
    const o = ownerHead[kind];
    if (o) {
      // Owner's calendar already has the event (via API sync) → don't attach the .ics to their
      // own notice, and drop the "invite attached" line so the copy stays accurate.
      const ownerIcs = ownerSynced ? null : ics;
      await mail.send({
        tenantId: tenant.id, to: owner, bcc: true, subject: o.subj,
        fromName: APP_NAME, replyTo: booking.customer.email,
        html: card(o.title, custDetails, o.note ?? (ownerIcs ? undefined : " ")),
        ...(ownerIcs ? { ics: { text: ownerIcs, method } } : {}),
      });
    }
  }
}
