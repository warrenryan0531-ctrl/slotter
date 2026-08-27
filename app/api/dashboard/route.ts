import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import * as repo from "@/lib/repo";
import { notifyBooking, decideBooking, refundBooking, promoteWaitlist, markNoShow, chargeNoShowFee } from "@/lib/booking";
import { removeConnection, listConnections } from "@/lib/calendar";
import { listZoomConnections, removeZoomConnection } from "@/lib/meetings";
import { newToken } from "@/lib/auth";

type Body = { action: string; [k: string]: unknown };

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = session.tenantId;
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.action) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const d = db();

  // helper: assert a staff id belongs to this tenant
  async function ownStaff(staffId: string): Promise<boolean> {
    const staff = await repo.staffForTenant(tenantId!);
    return staff.some((s) => s.id === staffId);
  }

  switch (body.action) {
    case "upsert_service": {
      const s = (body.service ?? {}) as Record<string, unknown>;
      const { data, error } = await d.rpc("bh_upsert_service", {
        p_tenant_id: tenantId, p_id: (s.id as string) || null,
        p_name: String(s.name ?? "").trim(), p_description: (s.description as string) ?? null,
        p_duration_min: Number(s.duration_min ?? 30), p_buffer_before_min: Number(s.buffer_before_min ?? 0),
        p_buffer_after_min: Number(s.buffer_after_min ?? 0), p_price_cents: s.price_cents == null ? null : Number(s.price_cents),
        p_kind: String(s.kind ?? "appointment"), p_location_mode: String(s.location_mode ?? "business"),
        p_booking_mode: String(s.booking_mode ?? "instant"), p_deposit_cents: s.deposit_cents == null ? null : Number(s.deposit_cents),
        p_requires_payment: Boolean(s.requires_payment), p_is_group: Boolean(s.is_group),
        p_capacity: Number(s.capacity ?? 1), p_active: s.active == null ? true : Boolean(s.active), p_sort: Number(s.sort ?? 0),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      // pay_mode is set via a follow-up update to avoid changing the RPC signature.
      if (s.pay_mode === "deposit" || s.pay_mode === "full") {
        await d.from("bh_services").update({ pay_mode: s.pay_mode }).eq("id", data).eq("tenant_id", tenantId);
      }
      // B3: no-show fee fields, same follow-up-update pattern (kept out of the RPC signature).
      if (s.protect_no_show !== undefined || s.no_show_fee_cents !== undefined || s.fee_model !== undefined) {
        const protect = Boolean(s.protect_no_show);
        const model = s.fee_model === "percent" ? "percent" : "flat";
        const raw = Number(s.no_show_fee_cents);
        // flat: $1–$1000 (cents). percent: 1–100. Clamp defensively; 0/invalid disables the charge.
        let fee: number | null = null;
        if (Number.isFinite(raw) && raw > 0) {
          fee = model === "percent" ? Math.min(Math.round(raw), 100) : Math.min(Math.max(Math.round(raw), 100), 100000);
        }
        await d.from("bh_services").update({ protect_no_show: protect, fee_model: model, no_show_fee_cents: fee }).eq("id", data).eq("tenant_id", tenantId);
      }
      return NextResponse.json({ ok: true, id: data });
    }
    // B3: owner-initiated no-show / late-cancel fee charge. Tenant-scoped; the domain fn re-checks
    // every guard (protected, eligible, card on file, not already charged) and is idempotent.
    case "charge_no_show_fee": {
      const bookingId = String(body.bookingId ?? "");
      if (!bookingId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const booking = await repo.bookingById(bookingId);
      if (!booking || booking.tenant_id !== tenantId) return NextResponse.json({ error: "not_found" }, { status: 404 });
      const res = await chargeNoShowFee(bookingId);
      if (!res.ok) return NextResponse.json({ error: res.reason }, { status: 400 });
      return NextResponse.json({ ok: true, chargedCents: res.chargedCents });
    }
    case "delete_service": {
      const { error } = await d.rpc("bh_delete_service", { p_tenant_id: tenantId, p_id: String(body.id ?? "") });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "assign_staff": {
      const { error } = await d.rpc("bh_assign_service_staff", { p_tenant_id: tenantId, p_service_id: String(body.serviceId ?? ""), p_staff_ids: (body.staffIds as string[]) ?? [] });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "upsert_intake": {
      const q = (body.question ?? {}) as Record<string, unknown>;
      const { data, error } = await d.rpc("bh_upsert_intake_question", {
        p_tenant_id: tenantId, p_id: (q.id as string) || null, p_service_id: String(q.service_id ?? ""),
        p_label: String(q.label ?? "").trim(), p_type: String(q.type ?? "text"),
        p_options: q.options ?? null, p_required: Boolean(q.required), p_sort: Number(q.sort ?? 0),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, id: data });
    }
    case "delete_intake": {
      const { error } = await d.rpc("bh_delete_intake_question", { p_tenant_id: tenantId, p_id: String(body.id ?? "") });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
    case "upsert_staff": {
      const st = (body.staff ?? {}) as Record<string, unknown>;
      const { data, error } = await d.rpc("bh_upsert_staff", {
        p_tenant_id: tenantId, p_id: (st.id as string) || null, p_name: String(st.name ?? "").trim(),
        p_email: (st.email as string) || null, p_is_owner: Boolean(st.is_owner), p_active: st.active == null ? true : Boolean(st.active),
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, id: data });
    }
    case "disconnect_calendar": {
      const staffId = String(body.staffId ?? "");
      const connId = String(body.id ?? "");
      if (!(await ownStaff(staffId))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const owned = (await listConnections(staffId)).some((c) => c.id === connId);
      if (!owned) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await removeConnection(connId);
      return NextResponse.json({ ok: true });
    }
    // B1 Layer B: disconnect a Zoom meeting connection (tenant-scoped via ownStaff + staff match).
    case "disconnect_zoom": {
      const staffId = String(body.staffId ?? "");
      const connId = String(body.id ?? "");
      if (!(await ownStaff(staffId))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const owned = (await listZoomConnections(staffId)).some((c) => c.id === connId);
      if (!owned) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await removeZoomConnection(connId, staffId);
      return NextResponse.json({ ok: true });
    }
    case "add_block": {
      const staffId = String(body.staffId ?? "");
      const starts = Number(body.start ?? 0), ends = Number(body.end ?? 0);
      if (!(await ownStaff(staffId)) || !starts || !ends || ends <= starts) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const { error } = await d.rpc("bh_add_block", {
        p_staff_id: staffId, p_starts_at: new Date(starts).toISOString(),
        p_ends_at: new Date(ends).toISOString(), p_reason: String(body.reason ?? "Blocked off"),
      });
      if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case "delete_block": {
      const id = String(body.id ?? "");
      const { data: blk } = await d.from("bh_blocks").select("id, staff_id").eq("id", id).limit(1);
      if (!blk?.length || !(await ownStaff(blk[0].staff_id))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await d.from("bh_blocks").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    }
    case "toggle_service": {
      const id = String(body.id ?? "");
      const svc = await repo.serviceById(id);
      if (!svc || svc.tenant_id !== tenantId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await d.from("bh_services").update({ active: !svc.active }).eq("id", id);
      return NextResponse.json({ ok: true, active: !svc.active });
    }
    case "toggle_booking_mode": {
      const id = String(body.id ?? "");
      const svc = await repo.serviceById(id);
      if (!svc || svc.tenant_id !== tenantId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const next = svc.booking_mode === "request" ? "instant" : "request";
      await d.from("bh_services").update({ booking_mode: next }).eq("id", id);
      return NextResponse.json({ ok: true, booking_mode: next });
    }
    case "decide_booking": {
      const id = String(body.id ?? "");
      const decision = body.decision === "approve" ? "approve" : body.decision === "decline" ? "decline" : null;
      if (!decision) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const booking = await repo.bookingById(id);
      if (!booking || booking.tenant_id !== tenantId || booking.status !== "pending") return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const res = await decideBooking(id, decision, session.role === "admin" ? "admin" : "owner");
      if (!res.ok) return NextResponse.json({ error: res.reason ?? "failed" }, { status: 409 });
      return NextResponse.json({ ok: true });
    }
    case "update_settings": {
      const t = await repo.tenantById(tenantId);
      if (!t) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const s = { ...t.settings } as Record<string, number>;
      for (const k of ["cutoff_hours", "min_notice_hours", "max_advance_days", "granularity_min"]) {
        if (body[k] !== undefined) {
          const v = Number(body[k]);
          if (!Number.isFinite(v) || v < 0 || v > 365 * 24) return NextResponse.json({ error: "bad_value", field: k }, { status: 400 });
          s[k] = v;
        }
      }
      if ((s.granularity_min ?? 30) < 5) return NextResponse.json({ error: "bad_value", field: "granularity_min" }, { status: 400 });
      await d.from("bh_tenants").update({ settings: s }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    case "update_reminders": {
      const t = await repo.tenantById(tenantId);
      if (!t) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const allowed = [1, 2, 24, 48];
      const hours = Array.isArray(body.hours) ? (body.hours as unknown[]).map(Number).filter((h) => allowed.includes(h)) : [];
      const s = { ...t.settings, reminder_hours: Array.from(new Set(hours)).sort((a, b) => b - a) };
      await d.from("bh_tenants").update({ settings: s }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    // Owner-controlled feature toggles that drive what customers see on the booking page.
    // Whitelisted so the dashboard can only flip known optional features, never arbitrary keys.
    case "set_feature": {
      const t = await repo.tenantById(tenantId);
      if (!t) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const FEATURE_KEYS = ["sms_enabled"];
      const key = String(body.key ?? "");
      if (!FEATURE_KEYS.includes(key)) return NextResponse.json({ error: "bad_feature", field: key }, { status: 400 });
      const s = { ...t.settings, [key]: Boolean(body.value) };
      await d.from("bh_tenants").update({ settings: s }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    // B2: post-visit review-request automation settings.
    case "update_review_request": {
      const t = await repo.tenantById(tenantId);
      if (!t) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const enabled = Boolean(body.enabled);
      const ALLOWED_DELAYS = [1, 3, 6, 24, 48, 72];
      const delay = Number(body.delayHours);
      const delayHours = ALLOWED_DELAYS.includes(delay) ? delay : 3;
      const channel = ["email", "sms", "both"].includes(String(body.channel)) ? String(body.channel) : "email";
      const rawUrl = typeof body.url === "string" ? body.url.trim().slice(0, 500) : "";
      let url = "";
      if (rawUrl) {
        try {
          const u = new URL(rawUrl);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("proto");
          url = u.toString();
        } catch {
          return NextResponse.json({ error: "bad_url", field: "url" }, { status: 400 });
        }
      }
      // Can't enable without a destination to send people to.
      if (enabled && !url) return NextResponse.json({ error: "url_required", field: "url" }, { status: 400 });
      const s = { ...t.settings, review_enabled: enabled, review_delay_hours: delayHours, review_url: url, review_channel: channel };
      await d.from("bh_tenants").update({ settings: s }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    case "update_branding": {
      const t = await repo.tenantById(tenantId);
      if (!t) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const b = { ...t.branding } as Record<string, string>;
      for (const k of ["color", "accent", "logo_url", "intro", "phone"]) {
        if (typeof body[k] === "string") b[k] = (body[k] as string).slice(0, 500);
      }
      await d.from("bh_tenants").update({ branding: b }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    case "add_rule": {
      const staffId = String(body.staffId ?? "");
      const weekday = Number(body.weekday), start_min = Number(body.startMin), end_min = Number(body.endMin);
      if (!(await ownStaff(staffId)) || weekday < 0 || weekday > 6 || !(end_min > start_min)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const { error } = await d.from("bh_availability_rules").insert({ staff_id: staffId, weekday, start_min, end_min });
      if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case "delete_rule": {
      const id = String(body.id ?? "");
      const { data: r } = await d.from("bh_availability_rules").select("id, staff_id").eq("id", id).limit(1);
      if (!r?.length || !(await ownStaff(r[0].staff_id))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await d.from("bh_availability_rules").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    }
    case "set_override": {
      const staffId = String(body.staffId ?? "");
      const date = String(body.date ?? "");
      if (!(await ownStaff(staffId)) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await d.from("bh_availability_overrides").upsert(
        { staff_id: staffId, date, closed: true, start_min: null, end_min: null },
        { onConflict: "staff_id,date" });
      return NextResponse.json({ ok: true });
    }
    case "delete_override": {
      const id = String(body.id ?? "");
      const { data: o } = await d.from("bh_availability_overrides").select("id, staff_id").eq("id", id).limit(1);
      if (!o?.length || !(await ownStaff(o[0].staff_id))) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await d.from("bh_availability_overrides").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    }
    case "create_event": {
      const serviceId = String(body.serviceId ?? "");
      const svc = await repo.serviceById(serviceId);
      if (!svc || svc.tenant_id !== tenantId || !svc.is_group) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const startMs = Number(body.start ?? 0);
      const durMin = Number(body.durationMin ?? svc.duration_min);
      const capacity = Math.max(1, Math.min(1000, Number(body.capacity ?? svc.capacity)));
      if (!startMs || startMs <= Date.now()) return NextResponse.json({ error: "bad_time" }, { status: 400 });
      const staff = await repo.staffForService(serviceId);
      const staffId2 = staff[0]?.id;
      if (!staffId2) return NextResponse.json({ error: "no_staff" }, { status: 400 });
      const { error } = await d.from("bh_events").insert({
        tenant_id: tenantId, service_id: serviceId, staff_id: staffId2,
        starts_at: new Date(startMs).toISOString(), ends_at: new Date(startMs + durMin * 60000).toISOString(), capacity,
      });
      if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    case "delete_event": {
      const id = String(body.id ?? "");
      const { data: ev } = await d.from("bh_events").select("id, tenant_id").eq("id", id).limit(1);
      if (!ev?.length || ev[0].tenant_id !== tenantId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      // cancel registrations, then remove the event (cascade also removes them; cancel first so customers are notified-eligible)
      await d.from("bh_bookings").update({ status: "cancelled" }).eq("event_id", id).in("status", ["confirmed", "pending"]);
      await d.from("bh_events").delete().eq("id", id);
      return NextResponse.json({ ok: true });
    }
    case "reset_feed": {
      await d.from("bh_tenants").update({ ics_token: newToken() }).eq("id", tenantId);
      return NextResponse.json({ ok: true });
    }
    case "cancel_booking": {
      const id = String(body.id ?? "");
      const booking = await repo.bookingById(id);
      if (!booking || booking.tenant_id !== tenantId || booking.status !== "confirmed") return NextResponse.json({ error: "bad_request" }, { status: 400 });
      const { data, error } = await d.rpc("bh_cancel_booking", { p_booking_id: id, p_actor: "owner" });
      if (error || !(data as { ok: boolean }).ok) return NextResponse.json({ error: "failed" }, { status: 500 });
      const tenant = await repo.tenantById(tenantId);
      const service = await repo.serviceById(booking.service_id);
      const staff = (await repo.staffForTenant(tenantId)).find((s) => s.id === booking.staff_id);
      const updated = await repo.bookingById(id);
      if (tenant && service && updated) await notifyBooking(tenant, service, staff ?? { id: "", tenant_id: tenantId, name: "", email: null, is_owner: false, active: true }, updated, "cancelled");
      if (booking.payment_status === "paid") await refundBooking(id);
      if (booking.event_id) await promoteWaitlist(booking.event_id);
      return NextResponse.json({ ok: true });
    }
    case "mark_no_show": {
      const id = String(body.id ?? "");
      const booking = await repo.bookingById(id);
      if (!booking || booking.tenant_id !== tenantId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await markNoShow(tenantId, id, body.value == null ? true : Boolean(body.value));
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "bad_action" }, { status: 400 });
  }
}
