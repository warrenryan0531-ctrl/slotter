import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { DashAction, ServiceEditor, IntakeEditor, StaffManager } from "@/components/dash";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const services = await repo.allServices(session.tenantId);
  const staff = await repo.staffForTenant(session.tenantId);
  const staffLite = staff.map((s) => ({ id: s.id, name: s.name }));

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Services</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">Everything customers can book. Create, edit, price, and set intake questions right here — no code.</p>

        <div className="mb-4"><ServiceEditor staff={staffLite} /></div>

        <div className="space-y-3">
          {await Promise.all(services.map(async (s) => {
            const questions = await repo.intakeQuestions(s.id);
            const assigned = (await repo.staffForService(s.id)).map((x) => x.id);
            return (
              <div key={s.id} className={`rounded-xl border p-4 ${s.active ? "bg-white border-gray-200" : "bg-gray-100 border-gray-200 opacity-70"}`} data-testid={`svc-${s.id}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.name} <span className="font-normal text-sm text-gray-500">· {s.duration_min} min{s.price_cents != null ? ` · $${(s.price_cents / 100).toFixed(0)}` : ""}</span>
                      <span className={`ml-2 inline-block rounded-full text-xs font-semibold px-2 py-0.5 ${s.booking_mode === "request" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>{s.booking_mode === "request" ? "Approve each" : "Auto-confirm"}</span>
                      {s.is_group && <span className="ml-2 inline-block rounded-full text-xs font-semibold px-2 py-0.5 bg-purple-100 text-purple-800">Group · {s.capacity} seats</span>}
                      {s.requires_payment && (s.deposit_cents ?? 0) > 0 && <span className="ml-2 inline-block rounded-full text-xs font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-800">${((s.deposit_cents ?? 0) / 100).toFixed(0)} deposit</span>}
                    </p>
                    {s.description && <p className="text-sm text-gray-500">{s.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ServiceEditor staff={staffLite} assigned={assigned} service={{
                      id: s.id, name: s.name, description: s.description, duration_min: s.duration_min,
                      price_cents: s.price_cents, kind: s.kind, location_mode: s.location_mode, booking_mode: s.booking_mode,
                      is_group: s.is_group, capacity: s.capacity, requires_payment: s.requires_payment, deposit_cents: s.deposit_cents,
                      buffer_before_min: s.buffer_before_min, buffer_after_min: s.buffer_after_min, active: s.active,
                    }} />
                    <DashAction label={s.active ? "Turn off" : "Turn on"} body={{ action: "toggle_service", id: s.id }} testid={`toggle-${s.id}`} />
                    <DashAction label="Delete" confirmMsg={`Delete "${s.name}"? This can't be undone.`} body={{ action: "delete_service", id: s.id }} testid={`del-svc-${s.id}`} />
                  </div>
                </div>
                <details className="mt-3">
                  <summary className="text-sm text-gray-600 cursor-pointer">Intake questions ({questions.length})</summary>
                  <IntakeEditor serviceId={s.id} questions={questions.map((q) => ({ id: q.id, label: q.label, type: q.type, required: q.required }))} />
                </details>
              </div>
            );
          }))}
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-1">Staff</h2>
        <p className="text-sm text-gray-500 mb-3">Add the people who take bookings. Assign them to services above.</p>
        <StaffManager staff={staff.map((s) => ({ id: s.id, name: s.name, email: s.email, is_owner: s.is_owner }))} />
      </section>
    </div>
  );
}
