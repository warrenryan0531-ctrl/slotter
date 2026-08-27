import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { fmtInTz } from "@/lib/engine/tz";
import { listConnections } from "@/lib/calendar";
import { listZoomConnections, zoomConfigured } from "@/lib/meetings";
import { APP_NAME } from "@/lib/brand";
import { CalendarConnectGuide } from "@/components/guides";
import { BlockForm, RuleForm, OverrideForm, DashAction } from "@/components/dash";

export const dynamic = "force-dynamic";
const PROVIDER_LABEL: Record<string, string> = { google: "Google Calendar", microsoft: "Outlook / Microsoft 365", demo: "Demo calendar" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const t = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${min < 720 ? "AM" : "PM"}`;

export default async function AvailabilityPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const staff = await repo.staffForTenant(tenant.id);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  // Calendar sync connections for the owner's own staff record.
  const ownerStaff = staff.find((s) => s.email?.toLowerCase() === session.email.toLowerCase()) ?? staff.find((s) => s.is_owner) ?? staff[0];
  const connections = ownerStaff ? await listConnections(ownerStaff.id) : [];
  const zoomConns = ownerStaff ? await listZoomConnections(ownerStaff.id) : [];
  const showZoom = zoomConfigured();

  return (
    <div className="space-y-8">
      <section data-testid="calendar-sync">
        <h2 className="font-semibold text-lg mb-1">Calendar sync</h2>
        <p className="text-sm text-gray-600 mb-3">Connect the calendar you already use. {APP_NAME} reads your busy times so it never books over them, and adds every booking to your calendar automatically.</p>
        <div className="space-y-2 mb-3">
          {connections.map((c) => (
            <div key={c.id} className="card flex items-center justify-between p-3 text-sm" data-testid="calendar-connection">
              <span><strong>{PROVIDER_LABEL[c.provider] ?? c.provider}</strong>{c.account_email ? ` · ${c.account_email}` : ""}</span>
              {ownerStaff && <DashAction label="Disconnect" body={{ action: "disconnect_calendar", id: c.id, staffId: ownerStaff.id }} testid={`cal-disc-${c.id}`} />}
            </div>
          ))}
          {connections.length === 0 && <p className="text-sm text-gray-500" data-testid="no-calendar">No calendar connected yet.</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href="/api/calendar/connect?provider=google" className="btn btn-primary btn-sm">Connect Google</a>
          <a href="/api/calendar/connect?provider=microsoft" className="btn btn-primary btn-sm">Connect Outlook</a>
          <a href="/api/calendar/connect?provider=demo" className="btn btn-secondary btn-sm" data-testid="connect-demo">Connect demo calendar</a>
        </div>
        <div className="mt-3">
          <CalendarConnectGuide defaultOpen={connections.length === 0} />
        </div>
      </section>

      {showZoom && (
        <section data-testid="zoom-sync">
          <h2 className="font-semibold text-lg mb-1">Zoom meetings</h2>
          <p className="text-sm text-gray-600 mb-3">Connect your Zoom account and every video-call booking gets a real Zoom meeting with a join link — created automatically, moved when the customer reschedules, and removed if they cancel. Without Zoom, video bookings use a Google Meet or Teams link from your connected calendar.</p>
          <div className="space-y-2 mb-3">
            {zoomConns.map((c) => (
              <div key={c.id} className="card flex items-center justify-between p-3 text-sm" data-testid="zoom-connection">
                <span><strong>Zoom</strong>{c.account_email ? ` · ${c.account_email}` : ""}</span>
                {ownerStaff && <DashAction label="Disconnect" body={{ action: "disconnect_zoom", id: c.id, staffId: ownerStaff.id }} testid={`zoom-disc-${c.id}`} />}
              </div>
            ))}
            {zoomConns.length === 0 && <p className="text-sm text-gray-500" data-testid="no-zoom">No Zoom account connected yet.</p>}
          </div>
          {zoomConns.length === 0 && (
            <a href="/api/zoom/connect" className="btn btn-primary btn-sm" data-testid="connect-zoom">Connect Zoom</a>
          )}
        </section>
      )}

      <section>
        <h2 className="font-semibold text-lg mb-1">Block off time</h2>
        <p className="text-sm text-gray-500 mb-3">Going to lunch, a job ran long, taking a day? Two taps and those slots disappear from your booking page.</p>
        <BlockForm staff={staff.map((s) => ({ id: s.id, name: s.name }))} />
        <div className="mt-3 space-y-2">
          {(await Promise.all(staff.map(async (s) => ({ s, blocks: await repo.blocksForStaff(s.id, nowIso) })))).flatMap(({ s, blocks }) =>
            blocks.map((b) => (
              <div key={b.id} className="card flex items-center justify-between p-3 text-sm" data-testid="block-row">
                <span>{staff.length > 1 ? `${s.name}: ` : ""}{fmtInTz(Date.parse(b.starts_at), tenant.tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} → {fmtInTz(Date.parse(b.ends_at), tenant.tz, { hour: "numeric", minute: "2-digit" })}</span>
                <DashAction label="Remove" body={{ action: "delete_block", id: b.id }} />
              </div>
            )))}
        </div>
      </section>

      {await Promise.all(staff.map(async (s) => {
        const rules = (await repo.rulesForStaff(s.id)).sort((a, b) => a.weekday - b.weekday || a.start_min - b.start_min);
        const overrides = (await repo.overridesForStaff(s.id, today)).filter((o) => o.closed);
        return (
          <section key={s.id}>
            <h2 className="font-semibold text-lg mb-1">{staff.length > 1 ? `${s.name}'s weekly hours` : "Weekly hours"}</h2>
            <div className="space-y-2 mb-3">
              {rules.map((r) => (
                <div key={r.id} className="card flex items-center justify-between p-3 text-sm">
                  <span><strong>{DAYS[r.weekday]}</strong> · {t(r.start_min)} – {t(r.end_min)}</span>
                  <DashAction label="Remove" body={{ action: "delete_rule", id: r.id }} />
                </div>
              ))}
              {rules.length === 0 && <p className="text-sm text-red-600">No hours set — customers can&apos;t book.</p>}
            </div>
            <RuleForm staffId={s.id} />
            <h3 className="font-medium mt-5 mb-1">Closed days</h3>
            <div className="space-y-2 mb-2">
              {overrides.map((o) => (
                <div key={o.id} className="card flex items-center justify-between p-3 text-sm">
                  <span>{o.date} — closed</span>
                  <DashAction label="Reopen" body={{ action: "delete_override", id: o.id }} />
                </div>
              ))}
            </div>
            <OverrideForm staffId={s.id} />
          </section>
        );
      }))}
    </div>
  );
}
