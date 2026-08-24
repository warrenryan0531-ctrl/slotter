"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

async function post(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.ok ? { ok: true } : { ok: false, error: (await r.json().catch(() => ({})))?.error };
}

export function LoginForm() {
  const router = useRouter();
  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 text-white glow-mark">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d="M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" /><path d="m9 14 2 2 4-4" />
            </svg>
          </span>
        </div>
        <div className="card card-pad">
          <h1 className="text-xl font-bold text-ink">Owner dashboard</h1>
          <p className="mb-5 mt-1 text-sm text-[#64726b]">Sign in with your email — we&apos;ll send you a code.</p>
          {err && <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">{err}</div>}
          {stage === "email" ? (
            <form onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              const r = await post("/api/auth/request-code", { email });
              setBusy(false);
              if (r.ok) setStage("code"); else setErr("Please enter a valid email.");
            }}>
              <input required type="email" data-testid="login-email" placeholder="you@business.com"
                className="input mb-3" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button disabled={busy} data-testid="login-send" className="btn btn-primary w-full">{busy ? "Sending…" : "Send code"}</button>
            </form>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              const r = await post("/api/auth/verify", { email, code });
              setBusy(false);
              if (r.ok) router.refresh(); else setErr("That code didn't work. Check it and try again.");
            }}>
              <input required inputMode="numeric" data-testid="login-code" placeholder="6-digit code"
                className="input mb-3 text-center text-lg tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value)} />
              <button disabled={busy} data-testid="login-verify" className="btn btn-primary w-full">{busy ? "Checking…" : "Sign in"}</button>
            </form>
          )}
          <div className="mt-4 rounded-lg border border-brand-100 bg-brand-50 p-3 text-xs text-brand-900" data-testid="demo-hint">
            <strong>Demo:</strong> owner@coastalshine.demo or maria@riveralaw.demo · code <strong>123456</strong>
          </div>
        </div>
      </div>
    </main>
  );
}

export function DashAction(p: { label: string; body: Record<string, unknown>; confirmMsg?: string; className?: string; testid?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button disabled={busy} data-testid={p.testid}
      className={p.className ?? "btn btn-secondary btn-sm"}
      onClick={async () => {
        if (p.confirmMsg && !confirm(p.confirmMsg)) return;
        setBusy(true);
        await post("/api/dashboard", p.body);
        setBusy(false);
        router.refresh();
      }}>
      {busy ? "…" : p.label}
    </button>
  );
}

// Owner-controlled feature switch. Flipping it saves immediately and (via router.refresh)
// re-renders anything that depends on it — including what customers see on the booking page.
export function FeatureToggle(p: { featureKey: string; initial: boolean; label: string; description?: string; testid?: string }) {
  const router = useRouter();
  const [on, setOn] = useState(p.initial);
  const [busy, setBusy] = useState(false);
  async function flip() {
    const next = !on;
    setBusy(true);
    setOn(next); // optimistic
    try {
      const res = await post("/api/dashboard", { action: "set_feature", key: p.featureKey, value: next });
      if (!res.ok) setOn(!next); // revert if the server rejected it
      else router.refresh();
    } catch {
      setOn(!next); // revert on failure
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card flex items-start justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="font-medium text-ink">{p.label}</p>
        {p.description && <p className="mt-0.5 text-sm text-[#64726b]">{p.description}</p>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={p.label} disabled={busy} onClick={flip} data-testid={p.testid}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-brand-600" : "bg-gray-300"} disabled:opacity-60`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// "Set up with your AI" — copy or download a personalized, secret-free handoff the owner pastes
// into any AI chat to turn it into their onboarding assistant.
export function AiSetupDoc(p: { text: string; filename?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const ok = () => { setCopied(true); setTimeout(() => setCopied(false), 2500); };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(p.text);
        return ok();
      }
      throw new Error("no clipboard api");
    } catch {
      // Legacy fallback for browsers/contexts where the async clipboard API is blocked.
      try {
        const ta = document.createElement("textarea");
        ta.value = p.text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
        return ok();
      } catch { /* both failed — the Download button is the guaranteed fallback */ }
    }
  }
  function download() {
    const blob = new Blob([p.text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = p.filename ?? "my-booking-setup.md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} data-testid="ai-copy" className="btn btn-primary">
          {copied ? "Copied — now paste it into your AI ✓" : "Copy for my AI"}
        </button>
        <button type="button" onClick={download} data-testid="ai-download" className="btn btn-secondary">
          Download as a file
        </button>
      </div>
      <details className="card bg-[#fafcfb]">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-[#42504a]">Preview what your AI will see</summary>
        <pre className="max-h-80 overflow-x-auto overflow-y-auto whitespace-pre-wrap break-words px-4 pb-4 pt-1 text-xs text-[#42504a]">{p.text}</pre>
      </details>
    </div>
  );
}

export function BlockForm(p: { staff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [staffId, setStaffId] = useState(p.staff[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const start = new Date(`${date}T${from}`).getTime();
      const end = new Date(`${date}T${to}`).getTime();
      await post("/api/dashboard", { action: "add_block", staffId, start, end, reason: "Blocked off" });
      setBusy(false); router.refresh();
    }}>
      {p.staff.length > 1 && (
        <select data-testid="block-staff" className="field bg-white" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          {p.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <input required type="date" data-testid="block-date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
      <input required type="time" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input required type="time" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
      <button disabled={busy} data-testid="block-add" className="btn btn-primary btn-sm">{busy ? "…" : "Block off"}</button>
    </form>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function RuleForm(p: { staffId: string }) {
  const router = useRouter();
  const [weekday, setWeekday] = useState(1);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [busy, setBusy] = useState(false);
  const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await post("/api/dashboard", { action: "add_rule", staffId: p.staffId, weekday, startMin: mins(from), endMin: mins(to) });
      setBusy(false); router.refresh();
    }}>
      <select className="field bg-white" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
        {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
      </select>
      <input required type="time" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
      <input required type="time" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
      <button disabled={busy} className="btn btn-primary btn-sm">{busy ? "…" : "Add hours"}</button>
    </form>
  );
}

export function OverrideForm(p: { staffId: string }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await post("/api/dashboard", { action: "set_override", staffId: p.staffId, date });
      setBusy(false); router.refresh();
    }}>
      <input required type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
      <button disabled={busy} className="btn btn-secondary btn-sm">{busy ? "…" : "Mark closed"}</button>
    </form>
  );
}

export function EventForm(p: { serviceId: string; defaultCapacity: number; defaultDuration: number }) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:00");
  const [capacity, setCapacity] = useState(p.defaultCapacity);
  const [busy, setBusy] = useState(false);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const start = new Date(`${date}T${time}`).getTime();
      await post("/api/dashboard", { action: "create_event", serviceId: p.serviceId, start, durationMin: p.defaultDuration, capacity });
      setBusy(false); setDate(""); router.refresh();
    }}>
      <input required type="date" data-testid="event-date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
      <input required type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} />
      <label className="text-sm text-[#64726b]">seats <input type="number" min={1} max={1000} className="field ml-1 w-20" value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
      <button disabled={busy} data-testid="event-add" className="btn btn-primary btn-sm">{busy ? "…" : "Add class"}</button>
    </form>
  );
}

export function SettingsForm(p: { initial: { cutoff_hours: number; min_notice_hours: number; max_advance_days: number; granularity_min: number } }) {
  const router = useRouter();
  const [v, setV] = useState(p.initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const F = (label: string, key: keyof typeof v, min: number, max: number) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" min={min} max={max} className="input"
        value={v[key]} onChange={(e) => { setSaved(false); setV({ ...v, [key]: Number(e.target.value) }); }} />
    </label>
  );
  return (
    <form className="grid grid-cols-2 gap-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await post("/api/dashboard", { action: "update_settings", ...v });
      setBusy(false); setSaved(true); router.refresh();
    }}>
      {F("Cancel/reschedule cutoff (hours)", "cutoff_hours", 0, 168)}
      {F("Minimum notice (hours)", "min_notice_hours", 0, 168)}
      {F("Book up to (days ahead)", "max_advance_days", 1, 365)}
      {F("Time slot size (minutes)", "granularity_min", 5, 240)}
      <button disabled={busy} data-testid="settings-save" className="btn btn-primary col-span-2 w-full">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
      </button>
    </form>
  );
}

export function RemindersForm(p: { initial: number[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<number[]>(p.initial);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const toggle = (h: number) => { setSaved(false); setSel((s) => s.includes(h) ? s.filter((x) => x !== h) : [...s, h]); };
  const opts: [number, string][] = [[48, "2 days before"], [24, "Day before"], [2, "2 hours before"], [1, "1 hour before"]];
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      await post("/api/dashboard", { action: "update_reminders", hours: sel });
      setBusy(false); setSaved(true); router.refresh();
    }}>
      <div className="mb-3 flex flex-wrap gap-2">
        {opts.map(([h, label]) => (
          <label key={h} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${sel.includes(h) ? "border-brand-600 bg-brand-600 text-white" : "border-[#dbe4df] bg-white text-[#42504a] hover:border-brand-300"}`}>
            <input type="checkbox" className="sr-only" data-testid={`rem-${h}`} checked={sel.includes(h)} onChange={() => toggle(h)} />
            {label}
          </label>
        ))}
      </div>
      <button disabled={busy} data-testid="reminders-save" className="btn btn-primary">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save reminders"}
      </button>
    </form>
  );
}

export function DemoPayButtons(p: { token: string; slug: string; amount: string }) {
  const [busy, setBusy] = useState<"" | "pay" | "cancel">("");
  const act = async (action: "pay" | "cancel") => {
    setBusy(action);
    await fetch(`/api/demo-pay/${p.token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    window.location.href = action === "pay" ? `/manage/${p.token}?paid=1` : `/b/${p.slug}?payment=cancelled`;
  };
  return (
    <div className="space-y-2">
      <button disabled={!!busy} data-testid="demo-pay" onClick={() => act("pay")} className="btn btn-primary w-full py-3">
        {busy === "pay" ? "Processing…" : `Pay $${p.amount} deposit (test)`}
      </button>
      <button disabled={!!busy} data-testid="demo-cancel" onClick={() => act("cancel")} className="btn btn-ghost w-full">
        Cancel and release my time
      </button>
    </div>
  );
}

export function CopyButton(p: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-secondary btn-sm shrink-0"
      onClick={async () => { await navigator.clipboard.writeText(p.text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? "Copied ✓" : (p.label ?? "Copy")}
    </button>
  );
}

export function AdminImpersonate(p: { tenantId: string; name: string }) {
  const router = useRouter();
  return (
    <button data-testid={`impersonate-${p.tenantId}`} className="btn btn-primary btn-sm"
      onClick={async () => { await post("/api/admin", { action: "impersonate", tenantId: p.tenantId }); router.push("/dashboard"); }}>
      Open {p.name}&apos;s dashboard
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button className="text-sm font-medium text-brand-700 hover:text-brand-800" data-testid="logout"
      onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.refresh(); }}>
      Sign out
    </button>
  );
}

// ---------------- E3: provisioning (no-SQL) ----------------
type SvcInit = {
  id?: string; name?: string; description?: string | null; duration_min?: number;
  price_cents?: number | null; kind?: string; location_mode?: string; booking_mode?: string;
  is_group?: boolean; capacity?: number; requires_payment?: boolean; deposit_cents?: number | null;
  buffer_before_min?: number; buffer_after_min?: number; active?: boolean; sort?: number;
};

export function ServiceEditor(p: { staff: { id: string; name: string }[]; assigned?: string[]; service?: SvcInit; startOpen?: boolean }) {
  const router = useRouter();
  const s = p.service ?? {};
  const [open, setOpen] = useState(p.startOpen ?? false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: s.name ?? "", description: s.description ?? "", duration_min: s.duration_min ?? 30,
    price: s.price_cents != null ? (s.price_cents / 100).toString() : "",
    kind: s.kind ?? "appointment", location_mode: s.location_mode ?? "business",
    booking_mode: s.booking_mode ?? "instant", is_group: s.is_group ?? false, capacity: s.capacity ?? 1,
    requires_payment: s.requires_payment ?? false, deposit: s.deposit_cents != null ? (s.deposit_cents / 100).toString() : "",
    pay_mode: (s as { pay_mode?: string }).pay_mode ?? "deposit",
    buffer_before_min: s.buffer_before_min ?? 0, buffer_after_min: s.buffer_after_min ?? 0, active: s.active ?? true,
  });
  const [assigned, setAssigned] = useState<string[]>(p.assigned ?? p.staff.map((x) => x.id));
  const set = (k: string, v: unknown) => setF((o) => ({ ...o, [k]: v }));

  if (!open) return <button data-testid={s.id ? `edit-svc-${s.id}` : "new-service"} onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">{s.id ? "Edit" : "＋ New service"}</button>;

  async function save() {
    setBusy(true); setErr(null);
    const svc = {
      id: s.id, name: f.name, description: f.description || null, duration_min: Number(f.duration_min),
      price_cents: f.price === "" ? null : Math.round(parseFloat(f.price) * 100),
      kind: f.kind, location_mode: f.location_mode, booking_mode: f.booking_mode,
      is_group: f.is_group, capacity: Number(f.capacity), requires_payment: f.requires_payment,
      deposit_cents: f.requires_payment && f.deposit !== "" ? Math.round(parseFloat(f.deposit) * 100) : null,
      pay_mode: f.pay_mode,
      buffer_before_min: Number(f.buffer_before_min), buffer_after_min: Number(f.buffer_after_min), active: f.active,
    };
    const r = await fetch("/api/dashboard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert_service", service: svc }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "Could not save"); setBusy(false); return; }
    const id = s.id ?? j.id;
    await post("/api/dashboard", { action: "assign_staff", serviceId: id, staffIds: assigned });
    setBusy(false); setOpen(false); router.refresh();
  }

  return (
    <div className="card p-4" data-testid="service-editor">
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2"><span className="label">Name</span><input data-testid="svc-name" className="input" value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
        <label className="col-span-2"><span className="label">Description</span><input className="input" value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
        <label><span className="label">Duration (min)</span><input type="number" className="input" value={f.duration_min} onChange={(e) => set("duration_min", e.target.value)} /></label>
        <label><span className="label">Price ($)</span><input type="number" step="0.01" className="input" value={f.price} onChange={(e) => set("price", e.target.value)} placeholder="optional" /></label>
        <label><span className="label">Type</span><select className="input" value={f.kind} onChange={(e) => set("kind", e.target.value)}><option value="appointment">In-person (they come to you)</option><option value="onsite">On-site (you go to them)</option><option value="call">Phone / call</option></select></label>
        <label><span className="label">Location</span><select className="input" value={f.location_mode} onChange={(e) => set("location_mode", e.target.value)}><option value="business">At the business</option><option value="address">Customer address</option><option value="phone">Phone</option></select></label>
        <label><span className="label">Confirmation</span><select data-testid="svc-mode" className="input" value={f.booking_mode} onChange={(e) => set("booking_mode", e.target.value)}><option value="instant">Auto-confirm</option><option value="request">Approve each request</option></select></label>
        <label className="mt-6 flex items-center gap-2 text-sm text-[#42504a]"><input type="checkbox" className="accent-brand-600" checked={f.is_group} onChange={(e) => set("is_group", e.target.checked)} /> Group class</label>
        {f.is_group && <label><span className="label">Capacity</span><input type="number" className="input" value={f.capacity} onChange={(e) => set("capacity", e.target.value)} /></label>}
        <label className="mt-6 flex items-center gap-2 text-sm text-[#42504a]"><input type="checkbox" className="accent-brand-600" checked={f.requires_payment} onChange={(e) => set("requires_payment", e.target.checked)} /> Require a deposit</label>
        {f.requires_payment && <label><span className="label">Deposit ($)</span><input type="number" step="0.01" className="input" value={f.deposit} onChange={(e) => set("deposit", e.target.value)} /></label>}
        {f.requires_payment && <label><span className="label">Charge</span><select className="input" value={f.pay_mode} onChange={(e) => set("pay_mode", e.target.value)}><option value="deposit">Deposit to hold</option><option value="full">Pay in full</option></select></label>}
      </div>
      {p.staff.length > 0 && (
        <div className="mt-3 text-sm"><span className="text-[#64726b]">Who performs this:</span>
          <div className="mt-1 flex flex-wrap gap-3">
            {p.staff.map((st) => (
              <label key={st.id} className="flex items-center gap-1 text-[#42504a]"><input type="checkbox" className="accent-brand-600" checked={assigned.includes(st.id)} onChange={(e) => setAssigned((a) => e.target.checked ? [...a, st.id] : a.filter((x) => x !== st.id))} /> {st.name}</label>
            ))}
          </div>
        </div>
      )}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <div className="mt-3 flex gap-2">
        <button data-testid="svc-save" disabled={busy || !f.name} onClick={save} className="btn btn-primary">{busy ? "Saving…" : "Save service"}</button>
        <button onClick={() => setOpen(false)} className="btn btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

export function StaffManager(p: { staff: { id: string; name: string; email: string | null; is_owner: boolean }[] }) {
  const router = useRouter();
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    await post("/api/dashboard", { action: "upsert_staff", staff: { name, email: email || null, is_owner: false } });
    setName(""); setEmail(""); setBusy(false); router.refresh();
  }
  return (
    <div className="space-y-2">
      {p.staff.map((s) => (
        <div key={s.id} className="card flex items-center justify-between p-3 text-sm">
          <span className="text-[#42504a]"><strong className="text-ink">{s.name}</strong>{s.is_owner ? " · owner" : ""}{s.email ? ` · ${s.email}` : ""}</span>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input className="field" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} data-testid="staff-name" />
        <input className="field" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button disabled={busy || !name} onClick={add} className="btn btn-primary btn-sm" data-testid="staff-add">Add staff</button>
      </div>
    </div>
  );
}

export function IntakeEditor(p: { serviceId: string; questions: { id: string; label: string; type: string; required: boolean }[] }) {
  const router = useRouter();
  const [label, setLabel] = useState(""); const [type, setType] = useState("text"); const [required, setRequired] = useState(false); const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true);
    await post("/api/dashboard", { action: "upsert_intake", question: { service_id: p.serviceId, label, type, required } });
    setLabel(""); setBusy(false); router.refresh();
  }
  return (
    <div className="mt-2 space-y-2">
      {p.questions.map((q) => (
        <div key={q.id} className="flex items-center justify-between rounded-lg border border-[#e4ebe7] bg-[#fafcfb] p-2 text-sm">
          <span className="text-[#42504a]">{q.label} <span className="text-[#7a8880]">· {q.type}{q.required ? " · required" : ""}</span></span>
          <DashAction label="Remove" body={{ action: "delete_intake", id: q.id }} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <input className="field" placeholder="Question (e.g. Vehicle make/model)" value={label} onChange={(e) => setLabel(e.target.value)} data-testid={`intake-label-${p.serviceId}`} />
        <select className="field bg-white" value={type} onChange={(e) => setType(e.target.value)}><option value="text">Short text</option><option value="textarea">Long text</option><option value="phone">Phone</option><option value="address">Address</option></select>
        <label className="flex items-center gap-1 text-sm text-[#42504a]"><input type="checkbox" className="accent-brand-600" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required</label>
        <button disabled={busy || !label} onClick={add} className="btn btn-secondary btn-sm" data-testid={`intake-add-${p.serviceId}`}>Add question</button>
      </div>
    </div>
  );
}

export function CreateTenant() {
  const router = useRouter();
  const [f, setF] = useState({ name: "", slug: "", tz: "America/New_York", ownerName: "", ownerEmail: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }));
  async function create() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_tenant", ...f }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? "Could not create"); setBusy(false); return; }
    setF({ name: "", slug: "", tz: "America/New_York", ownerName: "", ownerEmail: "" }); setBusy(false); router.refresh();
  }
  return (
    <div className="card p-4" data-testid="create-tenant">
      <h3 className="font-semibold text-ink">Add a business</h3>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input className="input" placeholder="Business name" value={f.name} onChange={(e) => set("name", e.target.value)} data-testid="ct-name" />
        <input className="input" placeholder="url-slug" value={f.slug} onChange={(e) => set("slug", e.target.value)} data-testid="ct-slug" />
        <input className="input" placeholder="Owner name" value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} />
        <input className="input" placeholder="Owner email" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} data-testid="ct-email" />
        <input className="input col-span-2" placeholder="Timezone (IANA)" value={f.tz} onChange={(e) => set("tz", e.target.value)} />
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      <button disabled={busy || !f.name || !f.slug || !f.ownerEmail} onClick={create} className="btn btn-primary mt-3" data-testid="ct-create">{busy ? "Creating…" : "Create business"}</button>
    </div>
  );
}

// ---------------- E5: market-edition signup ----------------
export function SignupForm() {
  const router = useRouter();
  const [stage, setStage] = useState<"form" | "code">("form");
  const [f, setF] = useState({ businessName: "", slug: "", ownerName: "", ownerEmail: "" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v, ...(k === "businessName" && !o.slug ? { slug: v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") } : {}) }));

  async function create() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error === "slug_taken" ? "That web address is taken — try another." : "Could not create your business."); setBusy(false); return; }
    setBusy(false); setStage("code");
  }
  async function verify() {
    setBusy(true); setErr(null);
    const r = await post("/api/signup/verify", { email: f.ownerEmail, code });
    if (!r.ok) { setErr("That code didn't work — check it and try again."); setBusy(false); return; }
    router.push("/dashboard/onboarding");
  }

  if (stage === "code") return (
    <div className="space-y-3">
      <p className="text-sm text-[#64726b]">We emailed a 6-digit code to <strong className="text-ink">{f.ownerEmail}</strong>. Enter it to finish.</p>
      <input inputMode="numeric" data-testid="signup-code" className="input text-center text-lg tracking-[0.4em]" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={busy || !code} onClick={verify} className="btn btn-primary w-full" data-testid="signup-verify">{busy ? "…" : "Start setting up →"}</button>
    </div>
  );

  return (
    <div className="space-y-3">
      <label className="block"><span className="label">Business name</span><input data-testid="signup-name" className="input" value={f.businessName} onChange={(e) => set("businessName", e.target.value)} placeholder="Blue Ridge Barbers" /></label>
      <label className="block"><span className="label">Your booking address</span><span className="flex items-center gap-1"><span className="text-sm text-[#64726b]">/b/</span><input data-testid="signup-slug" className="input" value={f.slug} onChange={(e) => set("slug", e.target.value)} placeholder="blue-ridge-barbers" /></span></label>
      <label className="block"><span className="label">Your name</span><input className="input" value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} placeholder="Sam" /></label>
      <label className="block"><span className="label">Your email</span><input type="email" data-testid="signup-email" className="input" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} placeholder="sam@business.com" /></label>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={busy || !f.businessName || !f.slug || !f.ownerEmail} onClick={create} className="btn btn-primary w-full" data-testid="signup-create">{busy ? "Creating…" : "Create my booking page — free"}</button>
    </div>
  );
}

export function UpgradeButton() {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setErr("Could not start checkout."); setBusy(false); return; }
    window.location.href = j.url;
  }
  return (
    <div>
      <button disabled={busy} onClick={go} className="btn btn-primary" data-testid="upgrade">{busy ? "…" : "Upgrade to Pro"}</button>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
