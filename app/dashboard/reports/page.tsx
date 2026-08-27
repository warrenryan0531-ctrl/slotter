import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { computeReport, defaultRange, type DayBucket } from "@/lib/reports";
import { ReportControls } from "@/components/reports";

export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDay = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}`; };

function StatCard({ value, label, tone = "brand" }: { value: string; label: string; tone?: "brand" | "amber" | "ink" }) {
  const chip = tone === "amber" ? "text-amber-600" : tone === "ink" ? "text-ink" : "text-brand-700";
  return (
    <div className="card card-pad">
      <p className={`text-[26px] font-bold leading-none tabular-nums ${chip}`}>{value}</p>
      <p className="mt-1.5 text-sm text-[#64726b]">{label}</p>
    </div>
  );
}

// Single-series magnitude bars (bookings/day). Thin marks, 4px rounded tops, recessive baseline,
// native <title> hover. One brand hue → no categorical palette needed.
function BarChart({ data, label }: { data: DayBucket[]; label: string }) {
  const W = 760, H = 200, padL = 34, padB = 22, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.bookings));
  const n = data.length;
  const bw = (W - padL - 6) / n;
  const barW = Math.max(1.5, Math.min(bw - 2, 26));
  const yOf = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const labelEvery = Math.ceil(n / 8);
  return (
    <figure className="card card-pad">
      <figcaption className="mb-2 text-sm font-medium text-ink">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: "block" }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="#8a988f">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * bw + (bw - barW) / 2;
          const h = (H - padT - padB) - (yOf(d.bookings) - padT);
          return (
            <g key={d.date}>
              {d.bookings > 0 && <rect x={x} y={yOf(d.bookings)} width={barW} height={Math.max(0, h)} rx={Math.min(4, barW / 2)} fill="var(--color-brand-600)" />}
              <title>{`${d.date}: ${d.bookings} booking${d.bookings === 1 ? "" : "s"}${d.noShows ? `, ${d.noShows} no-show` : ""}`}</title>
              {i % labelEvery === 0 && <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#8a988f">{shortDay(d.date)}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// Single-series change-over-time (revenue/day). 2px line + faint area, recessive grid, native hover.
function LineChart({ data, label }: { data: DayBucket[]; label: string }) {
  const W = 760, H = 200, padL = 46, padB = 22, padT = 10;
  const max = Math.max(1, ...data.map((d) => d.revenueCents));
  const n = data.length;
  const xOf = (i: number) => padL + (W - padL - 6) * (n <= 1 ? 0.5 : i / (n - 1));
  const yOf = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const pts = data.map((d, i) => `${xOf(i)},${yOf(d.revenueCents)}`).join(" ");
  const area = `${padL},${yOf(0)} ${pts} ${xOf(n - 1)},${yOf(0)}`;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(n / 8);
  return (
    <figure className="card card-pad">
      <figcaption className="mb-2 text-sm font-medium text-ink">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: "block" }}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={padL} x2={W} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={yOf(t) + 3} textAnchor="end" fontSize={10} fill="#8a988f">{money(t).replace(".00", "")}</text>
          </g>
        ))}
        <polygon points={area} fill="var(--color-brand-600)" opacity={0.08} />
        <polyline points={pts} fill="none" stroke="var(--color-brand-600)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <g key={d.date}>
            {d.revenueCents > 0 && <circle cx={xOf(i)} cy={yOf(d.revenueCents)} r={2.5} fill="var(--color-brand-600)" />}
            <title>{`${d.date}: ${money(d.revenueCents)}`}</title>
            {i % labelEvery === 0 && <text x={xOf(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#8a988f">{shortDay(d.date)}</text>}
          </g>
        ))}
      </svg>
    </figure>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;

  const sp = await searchParams;
  const def = defaultRange(tenant.tz, Date.now());
  const from = sp.from || def.from;
  const to = sp.to || def.to;

  let report;
  try {
    report = await computeReport(tenant.id, from, to, tenant.tz);
  } catch {
    report = null;
  }

  const hasData = report && report.rows.length > 0;

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-ink">Reports</h2>
      <p className="mb-4 text-sm text-[#64726b]">How your bookings, revenue, and no-shows are trending. Pick a range or download the raw data.</p>

      <ReportControls from={from} to={to} />

      {!report ? (
        <div className="card card-pad text-center text-[#64726b]">That date range doesn&apos;t look right — try again.</div>
      ) : !hasData ? (
        <div className="card card-pad text-center">
          <p className="text-[#64726b]">No bookings in this range yet.</p>
          <p className="mt-1 text-sm text-[#8a988f]">Once you take bookings, your trends and revenue will show up here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard value={String(report.totals.confirmed)} label="Booked appointments" />
            <StatCard value={money(report.totals.revenueCents)} label="Revenue collected" />
            <StatCard value={`${Math.round(report.totals.noShowRate * 100)}%`} label={`No-show rate (${report.totals.noShows})`} tone={report.totals.noShowRate > 0 ? "amber" : "brand"} />
            <StatCard value={String(report.totals.cancelled)} label="Cancellations" tone="ink" />
          </div>

          <BarChart data={report.byDay} label="Bookings per day" />
          <LineChart data={report.byDay} label="Revenue collected per day" />

          <div className="grid gap-5 md:grid-cols-2">
            <div className="card card-pad">
              <p className="mb-3 text-sm font-medium text-ink">Top services</p>
              {report.byService.length === 0 ? <p className="text-sm text-[#8a988f]">—</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[#8a988f]"><th className="pb-2 font-medium">Service</th><th className="pb-2 text-right font-medium">Bookings</th><th className="pb-2 text-right font-medium">Revenue</th></tr></thead>
                  <tbody>
                    {report.byService.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--border)]"><td className="py-2 text-ink">{s.name}</td><td className="py-2 text-right tabular-nums">{s.bookings}</td><td className="py-2 text-right tabular-nums text-[#64726b]">{money(s.revenueCents)}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card card-pad">
              <p className="mb-3 text-sm font-medium text-ink">By team member</p>
              {report.byStaff.length === 0 ? <p className="text-sm text-[#8a988f]">—</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[#8a988f]"><th className="pb-2 font-medium">Team member</th><th className="pb-2 text-right font-medium">Bookings</th></tr></thead>
                  <tbody>
                    {report.byStaff.map((s) => (
                      <tr key={s.id} className="border-t border-[var(--border)]"><td className="py-2 text-ink">{s.name}</td><td className="py-2 text-right tabular-nums">{s.bookings}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
