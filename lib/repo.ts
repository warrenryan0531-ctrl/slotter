import { db } from "./db";
import type { Tenant, Staff, Service, IntakeQuestion, AvailabilityRule, AvailabilityOverride, Block, Booking, BookingEvent } from "./types";

export type EventWithSeats = BookingEvent & { seats_taken: number; seats_left: number };

/** Upcoming, active events for a group service with live seat counts. */
export async function eventsWithSeats(serviceId: string): Promise<EventWithSeats[]> {
  const nowIso = new Date().toISOString();
  const { data: events } = await db().from("bh_events").select("*").eq("service_id", serviceId).eq("active", true).gt("starts_at", nowIso).order("starts_at");
  const list = (events as BookingEvent[]) ?? [];
  if (list.length === 0) return [];
  const { data: regs } = await db().from("bh_bookings").select("event_id, status").in("event_id", list.map((e) => e.id)).in("status", ["confirmed", "pending"]);
  const taken = new Map<string, number>();
  for (const r of (regs ?? []) as { event_id: string }[]) taken.set(r.event_id, (taken.get(r.event_id) ?? 0) + 1);
  return list.map((e) => {
    const t = taken.get(e.id) ?? 0;
    return { ...e, seats_taken: t, seats_left: Math.max(0, e.capacity - t) };
  });
}

export async function eventById(id: string): Promise<BookingEvent | null> {
  const { data } = await db().from("bh_events").select("*").eq("id", id).limit(1);
  return (data?.[0] as BookingEvent) ?? null;
}

export async function eventsForTenant(tenantId: string, fromIso: string): Promise<BookingEvent[]> {
  const { data } = await db().from("bh_events").select("*").eq("tenant_id", tenantId).gte("ends_at", fromIso).order("starts_at");
  return (data as BookingEvent[]) ?? [];
}

export async function registrationsForEvent(eventId: string): Promise<Booking[]> {
  const { data } = await db().from("bh_bookings").select("*").eq("event_id", eventId).in("status", ["confirmed", "pending"]).order("created_at");
  return (data as Booking[]) ?? [];
}

export async function tenantBySlug(slug: string): Promise<Tenant | null> {
  const { data } = await db().from("bh_tenants").select("*").eq("slug", slug).limit(1);
  return (data?.[0] as Tenant) ?? null;
}

export async function tenantById(id: string): Promise<Tenant | null> {
  const { data } = await db().from("bh_tenants").select("*").eq("id", id).limit(1);
  return (data?.[0] as Tenant) ?? null;
}

export async function tenantByIcsToken(token: string): Promise<Tenant | null> {
  const { data } = await db().from("bh_tenants").select("*").eq("ics_token", token).limit(1);
  return (data?.[0] as Tenant) ?? null;
}

export async function activeServices(tenantId: string): Promise<Service[]> {
  const { data } = await db().from("bh_services").select("*").eq("tenant_id", tenantId).eq("active", true).order("sort");
  return (data as Service[]) ?? [];
}

export async function allServices(tenantId: string): Promise<Service[]> {
  const { data } = await db().from("bh_services").select("*").eq("tenant_id", tenantId).order("sort");
  return (data as Service[]) ?? [];
}

export async function serviceById(id: string): Promise<Service | null> {
  const { data } = await db().from("bh_services").select("*").eq("id", id).limit(1);
  return (data?.[0] as Service) ?? null;
}

export async function staffForService(serviceId: string): Promise<Staff[]> {
  const { data } = await db().from("bh_service_staff").select("bh_staff(*)").eq("service_id", serviceId);
  const rows = (data ?? []).map((r) => (r as unknown as { bh_staff: Staff }).bh_staff).filter((s) => s && s.active);
  return rows;
}

export async function staffForTenant(tenantId: string): Promise<Staff[]> {
  const { data } = await db().from("bh_staff").select("*").eq("tenant_id", tenantId).eq("active", true).order("name");
  return (data as Staff[]) ?? [];
}

export async function intakeQuestions(serviceId: string): Promise<IntakeQuestion[]> {
  const { data } = await db().from("bh_intake_questions").select("*").eq("service_id", serviceId).order("sort");
  return (data as IntakeQuestion[]) ?? [];
}

export async function rulesForStaff(staffId: string): Promise<AvailabilityRule[]> {
  const { data } = await db().from("bh_availability_rules").select("*").eq("staff_id", staffId);
  return (data as AvailabilityRule[]) ?? [];
}

export async function overridesForStaff(staffId: string, fromDate: string): Promise<AvailabilityOverride[]> {
  const { data } = await db().from("bh_availability_overrides").select("*").eq("staff_id", staffId).gte("date", fromDate);
  return (data as AvailabilityOverride[]) ?? [];
}

export async function blocksForStaff(staffId: string, fromIso: string): Promise<Block[]> {
  const { data } = await db().from("bh_blocks").select("*").eq("staff_id", staffId).gte("ends_at", fromIso);
  return (data as Block[]) ?? [];
}

/** Bookings that HOLD a slot: confirmed AND pending (a pending request reserves the time). */
export async function heldBookingsForStaff(staffId: string, fromIso: string): Promise<Booking[]> {
  const { data } = await db().from("bh_bookings").select("*").eq("staff_id", staffId).in("status", ["confirmed", "pending"]).gte("ends_at", fromIso);
  return (data as Booking[]) ?? [];
}

export async function pendingBookingsForTenant(tenantId: string): Promise<Booking[]> {
  const { data } = await db().from("bh_bookings").select("*").eq("tenant_id", tenantId).eq("status", "pending").gte("ends_at", new Date().toISOString()).order("starts_at");
  return (data as Booking[]) ?? [];
}

export async function bookingsForTenant(tenantId: string, fromIso?: string): Promise<Booking[]> {
  let q = db().from("bh_bookings").select("*").eq("tenant_id", tenantId).order("starts_at");
  if (fromIso) q = q.gte("ends_at", fromIso);
  const { data } = await q;
  return (data as Booking[]) ?? [];
}

export async function bookingByManageToken(token: string): Promise<Booking | null> {
  const { data } = await db().from("bh_bookings").select("*").eq("manage_token", token).limit(1);
  return (data?.[0] as Booking) ?? null;
}

export async function bookingById(id: string): Promise<Booking | null> {
  const { data } = await db().from("bh_bookings").select("*").eq("id", id).limit(1);
  return (data?.[0] as Booking) ?? null;
}

export async function ownerEmail(tenantId: string): Promise<string | null> {
  const { data } = await db().from("bh_staff").select("email").eq("tenant_id", tenantId).eq("is_owner", true).limit(1);
  return data?.[0]?.email ?? null;
}
