import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { fmtInTz } from "@/lib/engine/tz";
import { EventForm, DashAction } from "@/components/dash";

export const dynamic = "force-dynamic";

export default async function ClassesPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const services = (await repo.allServices(tenant.id)).filter((s) => s.is_group);

  if (services.length === 0) {
    return <p className="text-sm text-gray-500" data-testid="no-group">No group/class services yet. Add a service with a capacity greater than 1 and it&apos;ll show up here.</p>;
  }

  const nowIso = new Date().toISOString();
  return (
    <div className="space-y-8">
      {await Promise.all(services.map(async (svc) => {
        const events = await repo.eventsWithSeats(svc.id);
        const past = (await repo.eventsForTenant(tenant.id, "1970-01-01")).filter((e) => e.service_id === svc.id && e.starts_at <= nowIso);
        void past;
        return (
          <section key={svc.id}>
            <h2 className="font-semibold text-lg mb-1">{svc.name}</h2>
            <p className="text-sm text-gray-500 mb-3">Add class times; customers reserve a seat until it&apos;s full. Default {svc.capacity} seats.</p>
            <EventForm serviceId={svc.id} defaultCapacity={svc.capacity} defaultDuration={svc.duration_min} />
            <div className="mt-4 space-y-3">
              {events.length === 0 && <p className="text-sm text-gray-500">No upcoming classes scheduled.</p>}
              {await Promise.all(events.map(async (ev) => {
                const roster = await repo.registrationsForEvent(ev.id);
                return (
                  <div key={ev.id} className="card p-4" data-testid="event-row">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">{fmtInTz(Date.parse(ev.starts_at), tenant.tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                        <p className={`text-sm ${ev.seats_left <= 0 ? "text-red-600" : ev.seats_left <= 3 ? "text-amber-600" : "text-gray-500"}`}>
                          {ev.seats_taken} / {ev.capacity} reserved{ev.seats_left <= 0 ? " · FULL" : ` · ${ev.seats_left} left`}
                        </p>
                        {roster.length > 0 && (
                          <ul className="mt-2 text-xs text-gray-500 space-y-0.5">
                            {roster.map((r) => (
                              <li key={r.id}>{r.customer.name} — <a className="underline" href={`tel:${r.customer.phone}`}>{r.customer.phone}</a>{r.status === "pending" ? " (pending)" : ""}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <DashAction label="Cancel class" body={{ action: "delete_event", id: ev.id }} confirmMsg="Cancel this class? Everyone registered is removed." testid={`del-event-${ev.id}`}
                        className="rounded-lg border border-red-200 text-red-600 px-3 py-1.5 text-sm shrink-0" />
                    </div>
                  </div>
                );
              }))}
            </div>
          </section>
        );
      }))}
    </div>
  );
}
