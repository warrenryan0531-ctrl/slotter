import * as repo from "./repo";
import type { FlowService } from "@/components/BookingFlow";
import { tenantSettings, type Tenant } from "./types";
import { smsAvailableForTenant } from "./services";

export async function loadFlow(slug: string): Promise<{ tenant: Tenant; services: FlowService[]; smsEnabled: boolean } | null> {
  const tenant = await repo.tenantBySlug(slug);
  if (!tenant) return null;
  // Show the SMS opt-in only when BOTH the owner has enabled it (dashboard toggle) AND the
  // platform can actually send (a provider is configured). Never collect consent we can't honor.
  const smsEnabled = tenantSettings(tenant).smsEnabled && (await smsAvailableForTenant(tenant.id));
  const services = await repo.activeServices(tenant.id);
  const out: FlowService[] = [];
  for (const s of services) {
    const [staff, questions] = await Promise.all([repo.staffForService(s.id), repo.intakeQuestions(s.id)]);
    if (staff.length === 0) continue;
    out.push({
      id: s.id, name: s.name, description: s.description, duration_min: s.duration_min,
      price_cents: s.price_cents, kind: s.kind, location_mode: s.location_mode,
      booking_mode: s.booking_mode, is_group: s.is_group,
      requires_payment: s.requires_payment, deposit_cents: s.deposit_cents,
      staff: staff.map((x) => ({ id: x.id, name: x.name })),
      questions: questions.map((q) => ({ id: q.id, label: q.label, type: q.type, options: q.options, required: q.required })),
    });
  }
  return { tenant, services: out, smsEnabled };
}
