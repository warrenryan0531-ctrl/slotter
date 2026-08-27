import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { describeWhen, computeFeeCents } from "@/lib/booking";
import { DashAction } from "@/components/dash";

export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default async function BookingsPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const services = await repo.allServices(tenant.id);
  const svcObj = (id: string) => services.find((s) => s.id === id);
  const svc = (id: string) => svcObj(id)?.name ?? "Appointment";
  const all = (await repo.bookingsForTenant(tenant.id)).slice(-100).reverse();

  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold text-ink">All bookings</h2>
      <div className="space-y-2">
        {all.map((b) => {
          const service = svcObj(b.service_id);
          // Charge the disclosed snapshot if present, else the current config (display only).
          const feeCents = b.fee_quote_cents ?? (service ? computeFeeCents(service) : 0);
          // Only owner-marked no-shows are chargeable (never on-time cancellations).
          const canCharge = !!service?.protect_no_show && b.no_show === true && !!b.stripe_payment_method_id && b.fee_charged_cents == null && feeCents > 0;
          return (
          <div key={b.id} className={`p-3 text-sm ${b.status === "cancelled" ? "rounded-[14px] border border-[#e4ebe7] bg-[#f1f4f2] text-[#7a8880]" : "card"}`}>
            <div className="flex justify-between gap-2">
              <span className="font-medium text-ink">{svc(b.service_id)} — {b.customer.name}</span>
              <span className="flex items-center gap-2">
                {b.payment_status === "paid" && <span className="text-xs font-semibold text-emerald-600">PAID</span>}
                {b.payment_status === "refunded" && <span className="text-xs font-semibold text-[#64726b]">REFUNDED</span>}
                {b.no_show && <span className="text-xs font-semibold text-orange-600">NO-SHOW</span>}
                {b.status === "cancelled" && <span className="text-xs font-semibold text-red-400">CANCELLED</span>}
                {b.fee_charged_cents != null && <span className="text-xs font-semibold text-emerald-600">FEE {money(b.fee_charged_cents)}</span>}
                {service?.protect_no_show && b.stripe_payment_method_id && b.fee_charged_cents == null && <span className="text-xs font-semibold text-[#64726b]" title="Card on file for no-show protection">🔒 CARD</span>}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>{describeWhen(b, tenant.tz)}</span>
              <span className="flex items-center gap-2">
                {canCharge && (
                  <DashAction label={`Charge ${money(feeCents)} no-show fee`} body={{ action: "charge_no_show_fee", bookingId: b.id }}
                    confirmMsg={`Charge the customer's saved card ${money(feeCents)} for this no-show? This moves real money and can't be undone here.`}
                    testid={`chargefee-${b.id}`} className="btn btn-secondary btn-sm shrink-0" />
                )}
                {b.status === "confirmed" && (
                  <DashAction label={b.no_show ? "Clear no-show" : "Mark no-show"} body={{ action: "mark_no_show", id: b.id, value: !b.no_show }} testid={`noshow-${b.id}`} />
                )}
              </span>
            </div>
          </div>
          );
        })}
        {all.length === 0 && (
          <div className="card card-pad text-center">
            <p className="text-[#64726b]">No bookings yet.</p>
            <p className="mt-1 text-sm text-[#8a988f]">Every booking — past and upcoming — will be listed here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
