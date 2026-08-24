"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  token: string; slug: string; serviceId: string; staffId: string;
  tz: string; color: string; canManage: boolean; cutoffHours: number; ownerPhone?: string;
  status: string;
};

function fmtTime(ms: number, tz: string) { return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms)); }
function fmtDay(ms: number, tz: string) { return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms)); }
function dayKey(ms: number, tz: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }

export default function ManageClient(p: Props) {
  const [mode, setMode] = useState<"view" | "reschedule" | "cancelled" | "rescheduled">("view");
  const [slots, setSlots] = useState<number[] | null>(null);
  const [dayIdx, setDayIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "reschedule") return;
    setSlots(null);
    fetch(`/api/slots?slug=${encodeURIComponent(p.slug)}&service=${p.serviceId}&staff=${p.staffId}`)
      .then((r) => r.json()).then((j) => setSlots(j.slots ?? [])).catch(() => setSlots([]));
  }, [mode, p.slug, p.serviceId, p.staffId]);

  const days = useMemo(() => {
    if (!slots) return [];
    const map = new Map<string, number[]>();
    for (const s of slots) { const k = dayKey(s, p.tz); if (!map.has(k)) map.set(k, []); map.get(k)!.push(s); }
    return [...map.entries()].map(([k, v]) => ({ key: k, label: fmtDay(v[0], p.tz), slots: v }));
  }, [slots, p.tz]);

  const act = async (body: Record<string, unknown>, onOk: () => void) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/manage/${p.token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error === "inside_cutoff" ? "Changes aren't allowed this close to the appointment — please call instead."
          : j.error === "invalid_slot" || j.error === "conflict" ? "That time was just taken — pick another."
          : "Something went wrong. Please try again.");
        return;
      }
      onOk();
    } catch { setError("Network error — please try again."); }
    finally { setBusy(false); }
  };

  if (p.status === "cancelled" || p.status === "declined" || mode === "cancelled") {
    const declined = p.status === "declined";
    return <div className="text-center py-4" data-testid="manage-cancelled">
      <p className="font-medium text-gray-800">{declined ? "This request wasn't able to be accommodated." : "This booking has been cancelled."}</p>
      <p className="text-sm text-gray-500 mt-1">Need a time? Book again from the website.</p>
    </div>;
  }

  if (p.status === "pending") {
    return <div data-testid="manage-pending">
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>}
      <button data-testid="btn-withdraw" disabled={busy} className="w-full rounded-xl border border-red-300 text-red-700 font-semibold py-3"
        onClick={() => { if (confirm("Withdraw this request?")) void act({ action: "cancel" }, () => setMode("cancelled")); }}>
        Withdraw request
      </button>
    </div>;
  }
  if (mode === "rescheduled") {
    return <div className="text-center py-4" data-testid="manage-rescheduled">
      <p className="font-medium text-green-700">✓ Rescheduled! A new calendar invite is on its way.</p>
    </div>;
  }

  if (!p.canManage) {
    return <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900" data-testid="manage-locked">
      Changes aren&apos;t available within {p.cutoffHours} hours of your appointment.
      {p.ownerPhone && <> Please call <a className="font-semibold underline" href={`tel:${p.ownerPhone}`}>{p.ownerPhone}</a>.</>}
    </div>;
  }

  return (
    <div data-testid="manage-actions">
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>}
      {mode === "view" && (
        <div className="space-y-2">
          <button data-testid="btn-reschedule" className="w-full rounded-xl text-white font-semibold py-3" style={{ background: p.color }} onClick={() => setMode("reschedule")}>Reschedule</button>
          <button data-testid="btn-cancel" disabled={busy} className="w-full rounded-xl border border-red-300 text-red-700 font-semibold py-3"
            onClick={() => { if (confirm("Cancel this booking?")) void act({ action: "cancel" }, () => setMode("cancelled")); }}>
            Cancel booking
          </button>
        </div>
      )}
      {mode === "reschedule" && (
        <div>
          <button className="text-sm text-gray-500 mb-3 underline" onClick={() => setMode("view")}>← Back</button>
          <h3 className="font-semibold mb-2">Pick a new time</h3>
          {!slots && <p className="text-sm text-gray-500">Loading times…</p>}
          {slots && days.length === 0 && <p className="text-sm text-gray-600">No other times available right now.</p>}
          {days.length > 0 && (
            <div>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
                {days.map((d, i) => (
                  <button key={d.key} className={`px-3 py-2 rounded-lg border text-sm whitespace-nowrap ${i === dayIdx ? "text-white border-transparent" : "border-gray-200 bg-white"}`}
                    style={i === dayIdx ? { background: p.color } : undefined} onClick={() => setDayIdx(i)}>{d.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {days[dayIdx].slots.map((s) => (
                  <button key={s} data-testid={`reslot-${s}`} disabled={busy} className="py-2 rounded-lg border border-gray-200 bg-white text-sm"
                    onClick={() => void act({ action: "reschedule", start: s }, () => setMode("rescheduled"))}>
                    {fmtTime(s, p.tz)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
