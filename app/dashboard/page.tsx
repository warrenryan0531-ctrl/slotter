import Link from "next/link";
import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { describeWhen } from "@/lib/booking";
import { listConnections } from "@/lib/calendar";
import { DashAction } from "@/components/dash";

export const dynamic = "force-dynamic";

const ymd = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

function StatCard({ icon, value, label, tone = "brand" }: { icon: React.ReactNode; value: number | string; label: string; tone?: "brand" | "amber" }) {
  const chip = tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-brand-50 text-brand-700";
  return (
    <div className="card card-pad card-hover">
      <span className={`grid h-10 w-10 place-items-center rounded-xl ${chip}`}>{icon}</span>
      <p className="mt-3 text-[28px] font-bold leading-none text-ink tabular-nums">{value}</p>
      <p className="mt-1.5 text-sm text-[#64726b]">{label}</p>
    </div>
  );
}

function Svg({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default async function TodayPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const services = await repo.allServices(tenant.id);
  const staff = await repo.staffForTenant(tenant.id);
  const all = await repo.bookingsForTenant(tenant.id, new Date().toISOString());
  const confirmed = all.filter((b) => b.status === "confirmed");
  const upcoming = confirmed.slice(0, 20);
  const pending = await repo.pendingBookingsForTenant(tenant.id);
  const svc = (id: string) => services.find((s) => s.id === id)?.name ?? "Appointment";
  const who = (id: string) => staff.find((s) => s.id === id)?.name;

  // Stats
  const now = Date.now();
  const todayStr = ymd(new Date().toISOString(), tenant.tz);
  const todayCount = confirmed.filter((b) => ymd(b.starts_at, tenant.tz) === todayStr).length;
  const weekCount = confirmed.filter((b) => {
    const t = Date.parse(b.starts_at);
    return t >= now && t <= now + 7 * 86400000;
  }).length;

  // Setup nudge
  const owner = staff.find((s) => s.email?.toLowerCase() === session.email.toLowerCase()) ?? staff.find((s) => s.is_owner) ?? staff[0];
  const firstName = (owner?.name ?? "").trim().split(/\s+/)[0] || "there";
  const rules = owner ? await repo.rulesForStaff(owner.id) : [];
  const conns = owner ? await listConnections(owner.id) : [];
  const setupTodo = [
    services.length === 0 && "add a service",
    rules.length === 0 && "set your hours",
    conns.length === 0 && "connect your calendar",
  ].filter(Boolean) as string[];

  const longDate = new Intl.DateTimeFormat("en-US", { timeZone: tenant.tz, weekday: "long", month: "long", day: "numeric" }).format(new Date());

  return (
    <div>
      {/* Greeting */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink sm:text-[28px]">Welcome back, {firstName} 👋</h1>
          <p className="mt-1 text-[#64726b]">{longDate} · here&apos;s what&apos;s happening at {tenant.name}.</p>
        </div>
        <Link href={`/b/${tenant.slug}`} target="_blank" className="btn btn-secondary">
          View booking page
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden><path d="M7 17 17 7M9 7h8v8" /></svg>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard icon={<Svg d="M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />} value={todayCount} label="Booked today" />
        <StatCard icon={<Svg d="M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />} value={pending.length} label="Awaiting your OK" tone="amber" />
        <StatCard icon={<Svg d="M9 11l3 3 8-8M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />} value={confirmed.length} label="Upcoming total" />
        <StatCard icon={<Svg d="M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />} value={weekCount} label="Next 7 days" />
      </div>

      {setupTodo.length > 0 && (
        <Link href="/dashboard/onboarding" data-testid="setup-nudge"
          className="mb-8 block overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5 transition-shadow hover:shadow-[var(--shadow-md)]">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden><path d="M5 13l4 4L19 7" /></svg>
            </span>
            <div>
              <p className="font-semibold text-brand-900">Finish setting up — you&apos;re almost there</p>
              <p className="mt-0.5 text-sm text-brand-800/80">Still to do: {setupTodo.join(", ")}. The Setup guide walks you through each one, step by step →</p>
            </div>
          </div>
        </Link>
      )}

      {pending.length > 0 && (
        <section className="mb-8" data-testid="requests-section">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-lg font-semibold text-ink">Requests awaiting your OK</h2>
            <span className="badge badge-amber">{pending.length}</span>
          </div>
          <p className="mb-4 text-sm text-[#64726b]">These times are held for the customer until you decide. Approving sends them a confirmation + calendar invite; declining frees the slot.</p>
          <div className="space-y-3">
            {pending.map((b) => (
              <div key={b.id} className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4" data-testid="request-card">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">{svc(b.service_id)}</p>
                    <p className="text-sm text-[#42504a]">{describeWhen(b, tenant.tz)}</p>
                    <p className="mt-1 text-sm text-[#64726b]">{b.customer.name} · <a className="text-brand-700 underline underline-offset-2" href={`tel:${b.customer.phone}`}>{b.customer.phone}</a></p>
                    {b.address && <p className="text-sm text-[#64726b]">{b.address.line}</p>}
                    {staff.length > 1 && who(b.staff_id) && <p className="mt-1 text-xs text-[#7a8880]">with {who(b.staff_id)}</p>}
                    {Object.entries(b.intake_answers).map(([k, v]) => (
                      <p key={k} className="mt-0.5 text-xs text-[#7a8880]"><em>{k}:</em> {v}</p>
                    ))}
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <DashAction label="Approve" body={{ action: "decide_booking", id: b.id, decision: "approve" }} testid={`approve-${b.id}`} className="btn btn-primary btn-sm" />
                    <DashAction label="Decline" body={{ action: "decide_booking", id: b.id, decision: "decline" }} confirmMsg="Decline this request? The slot is freed and the customer is notified." testid={`decline-${b.id}`} className="btn btn-danger btn-sm" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <h2 className="mb-4 text-lg font-semibold text-ink">Upcoming bookings</h2>
      {upcoming.length === 0 && (
        <div className="card card-pad text-center" data-testid="no-upcoming">
          <p className="text-[#64726b]">No upcoming bookings yet.</p>
          <p className="mt-1 text-sm text-[#8a988f]">Share your booking link and they&apos;ll show up here.</p>
        </div>
      )}
      <div className="space-y-3">
        {upcoming.map((b) => (
          <div key={b.id} className="card card-hover p-4" data-testid="booking-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Svg d="M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
                </span>
                <div>
                  <p className="font-semibold text-ink">{svc(b.service_id)}</p>
                  <p className="text-sm text-[#42504a]">{describeWhen(b, tenant.tz)}</p>
                  <p className="mt-1 text-sm text-[#64726b]">
                    {b.customer.name} · <a className="text-brand-700 underline underline-offset-2" href={`tel:${b.customer.phone}`}>{b.customer.phone}</a> · <a className="text-brand-700 underline underline-offset-2" href={`sms:${b.customer.phone}`}>text</a>
                  </p>
                  {b.address && <p className="text-sm text-[#64726b]">{b.address.line}</p>}
                  {staff.length > 1 && who(b.staff_id) && <p className="mt-1 text-xs text-[#7a8880]">with {who(b.staff_id)}</p>}
                  {Object.entries(b.intake_answers).map(([k, v]) => (
                    <p key={k} className="mt-0.5 text-xs text-[#7a8880]"><em>{k}:</em> {v}</p>
                  ))}
                </div>
              </div>
              <DashAction label="Cancel" body={{ action: "cancel_booking", id: b.id }} confirmMsg="Cancel this booking? The customer will be notified." testid={`cancel-${b.id}`} className="btn btn-danger btn-sm shrink-0" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
