"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { APP_NAME, SHOW_ATTRIBUTION } from "@/lib/brand";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// B3: customer card-vault step. The booking already exists; here the customer saves a card
// (Stripe SetupIntent) so the business can charge a fee ONLY if they no-show / cancel late.
// Nothing is charged now. "Skip" leaves the booking standing without card protection.
function CardVaultForm(p: { clientSecret: string; manageToken: string; feeCents: number; onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    const card = elements.getElement(CardElement);
    if (!card) { setErr("Card field isn't ready yet — one moment."); return; }
    setBusy(true); setErr(null);
    const { error, setupIntent } = await stripe.confirmCardSetup(p.clientSecret, { payment_method: { card } });
    if (error || !setupIntent) { setErr(error?.message ?? "That card couldn't be saved. Please try another."); setBusy(false); return; }
    try {
      await fetch("/api/book/card-saved", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ manageToken: p.manageToken, setupIntentId: setupIntent.id }) });
    } catch { /* the card is vaulted on Stripe; if recording hiccups the owner can retry — don't block the customer */ }
    setBusy(false); p.onDone();
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <CardElement options={{ hidePostalCode: false, style: { base: { fontSize: "16px" } } }} />
      </div>
      {err && <p className="text-sm text-red-600" data-testid="card-err">{err}</p>}
      <button type="submit" disabled={busy || !stripe} data-testid="card-save" className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "var(--bh-color)" }}>
        {busy ? "Saving…" : "Save card & finish"}
      </button>
    </form>
  );
}

export type FlowService = {
  id: string; name: string; description: string | null; duration_min: number;
  price_cents: number | null; kind: string; location_mode: string;
  booking_mode: "instant" | "request";
  is_group: boolean;
  requires_payment: boolean; deposit_cents: number | null;
  staff: { id: string; name: string }[];
  questions: { id: string; label: string; type: string; options: string[] | null; required: boolean }[];
};

export type FlowProps = {
  slug: string;
  tenantName: string;
  tz: string;
  color: string;
  accent: string;
  intro?: string;
  services: FlowService[];
  embedded?: boolean;
  smsEnabled?: boolean;
};

type Step = "service" | "staff" | "time" | "event" | "details" | "card" | "done";
type EventOption = { id: string; start: number; end: number; seatsLeft: number; capacity: number };

function fmtTime(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}
function fmtDay(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms));
}
function dayKey(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
function price(cents: number | null): string {
  return cents == null ? "" : `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export default function BookingFlow(p: FlowProps) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<FlowService | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [slots, setSlots] = useState<number[] | null>(null);
  const [slotsError, setSlotsError] = useState(false);
  const [dayIdx, setDayIdx] = useState(0);
  const [start, setStart] = useState<number | null>(null);
  const [events, setEvents] = useState<EventOption[] | null>(null);
  const [eventsError, setEventsError] = useState(false);
  const [chosenEvent, setChosenEvent] = useState<EventOption | null>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, { status: "up" | "done" | "err"; name?: string; msg?: string }>>({});

  // B5: upload one intake file directly to a scoped signed URL (bytes never touch our server),
  // then store the answer as `file::<path>::<name>` so the owner gets a secure download link.
  async function handleFile(qid: string, file: File | undefined) {
    if (!file) { setFiles((s) => ({ ...s, [qid]: undefined as never })); setIntake((m) => ({ ...m, [qid]: "" })); return; }
    if (file.size > 10 * 1024 * 1024) { setFiles((s) => ({ ...s, [qid]: { status: "err", msg: "That file is over 10MB." } })); return; }
    setFiles((s) => ({ ...s, [qid]: { status: "up", name: file.name } }));
    try {
      const r = await fetch("/api/intake/upload-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: p.slug, filename: file.name, contentType: file.type, size: file.size }) });
      const j = await r.json();
      if (!r.ok) { setFiles((s) => ({ ...s, [qid]: { status: "err", msg: j.error === "bad_type" ? "Please upload a photo or PDF." : j.error === "too_large" ? "That file is over 10MB." : "Couldn't upload — try again." } })); return; }
      const put = await fetch(j.signedUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!put.ok) { setFiles((s) => ({ ...s, [qid]: { status: "err", msg: "Upload failed — try again." } })); return; }
      setIntake((m) => ({ ...m, [qid]: `file::${j.path}::${j.name}` }));
      setFiles((s) => ({ ...s, [qid]: { status: "done", name: j.name } }));
    } catch {
      setFiles((s) => ({ ...s, [qid]: { status: "err", msg: "Network error — try again." } }));
    }
  }
  const [smsConsent, setSmsConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manageToken, setManageToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [protect, setProtect] = useState<{ clientSecret: string; publishableKey: string; feeCents: number } | null>(null);
  const stripePromise = useMemo<Promise<Stripe | null> | null>(
    () => (protect?.publishableKey ? loadStripe(protect.publishableKey) : null),
    [protect?.publishableKey],
  );
  const [waitlist, setWaitlist] = useState(false);      // E4: joining a full class's waitlist
  const [waitlistDone, setWaitlistDone] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // embed auto-resize (resolution #11: outbound resize is non-sensitive, posted to *)
  useEffect(() => {
    if (!p.embedded || !rootRef.current) return;
    const el = rootRef.current;
    const post = () => window.parent?.postMessage({ type: "slotter:resize", height: el.scrollHeight + 24 }, "*");
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [p.embedded]);

  const loadSlots = useCallback(async (svc: FlowService, sid: string) => {
    setSlots(null); setSlotsError(false); setDayIdx(0); setStart(null);
    try {
      const r = await fetch(`/api/slots?slug=${encodeURIComponent(p.slug)}&service=${svc.id}&staff=${sid}`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      setSlots(j.slots as number[]);
    } catch { setSlotsError(true); }
  }, [p.slug]);

  const loadEvents = useCallback(async (svc: FlowService) => {
    setEvents(null); setEventsError(false); setChosenEvent(null);
    try {
      const r = await fetch(`/api/events?slug=${encodeURIComponent(p.slug)}&service=${svc.id}`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      setEvents(j.events as EventOption[]);
    } catch { setEventsError(true); }
  }, [p.slug]);

  const pickService = (svc: FlowService) => {
    setService(svc); setError(null);
    if (svc.is_group) {                       // V4: group class → event list, no staff/slot steps
      setStaffId(svc.staff[0]?.id ?? null);
      setStep("event");
      void loadEvents(svc);
    } else if (svc.staff.length > 1) {
      setStep("staff");
    } else {
      const sid = svc.staff[0]?.id ?? null;
      setStaffId(sid);
      setStep("time");
      if (sid) void loadSlots(svc, sid);
    }
  };

  const pickStaff = (sid: string) => {
    setStaffId(sid); setStep("time");
    if (service) void loadSlots(service, sid);
  };

  const days = useMemo(() => {
    if (!slots) return [];
    const map = new Map<string, number[]>();
    for (const s of slots) {
      const k = dayKey(s, p.tz);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(s);
    }
    return [...map.entries()].map(([k, v]) => ({ key: k, label: fmtDay(v[0], p.tz), slots: v }));
  }, [slots, p.tz]);

  const submit = async () => {
    if (!service) return;
    const group = service.is_group;
    if (group ? !chosenEvent : !(staffId && start)) return;
    setBusy(true); setError(null);
    try {
      // E4: waitlist join instead of a booking when the chosen class is full.
      if (group && waitlist && chosenEvent) {
        const wr = await fetch("/api/waitlist", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: p.slug, eventId: chosenEvent.id, customer: { name, phone, email }, smsConsent }),
        });
        if (!wr.ok) { setError("Couldn't join the waitlist. Please try again."); return; }
        setWaitlistDone(true); setStep("done");
        return;
      }
      const r = await fetch("/api/book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group
          ? { slug: p.slug, serviceId: service.id, eventId: chosenEvent!.id, customer: { name, phone, email }, intake, smsConsent }
          : { slug: p.slug, serviceId: service.id, staffId, start, customer: { name, phone, email }, intake, address, smsConsent }),
      });
      const j = await r.json();
      if (!r.ok) {
        if (j.error === "full") {
          setError("Sorry — that class just filled up. Please pick another.");
          setStep("event");
          void loadEvents(service);
        } else if (j.error === "conflict" || j.error === "invalid") {
          setError("Sorry — that time was just taken. Please pick another slot.");
          setStep("time");
          if (staffId) void loadSlots(service, staffId);
        } else if (j.error === "intake_required") {
          setError(`Please answer: ${j.label}`);
        } else if (j.error === "address_required") {
          setError("Please enter your address.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        return;
      }
      if (j.paid && j.paymentUrl) { window.location.href = j.paymentUrl as string; return; } // V3: off to checkout
      setManageToken(j.manageToken);
      setPending(Boolean(j.pending));
      // B3: protected service returns a card-vault client secret → collect a card before finishing.
      if (j.protect?.clientSecret && j.protect?.publishableKey) {
        setProtect({ clientSecret: j.protect.clientSecret, publishableKey: j.protect.publishableKey, feeCents: Number(j.protect.feeCents ?? 0) });
        setStep("card");
      } else {
        setStep("done");
      }
    } catch {
      setError("Network error — please try again.");
    } finally { setBusy(false); }
  };

  const doneStart = service?.is_group ? (chosenEvent?.start ?? null) : (start ?? null);
  const S = { "--bh-color": p.color, "--bh-accent": p.accent } as React.CSSProperties;
  const btn = "w-full text-left rounded-xl border border-gray-200 p-4 hover:border-[var(--bh-color)] transition-colors bg-white";
  const back = (to: Step) => (
    <button className="text-sm text-gray-500 mb-3 underline" onClick={() => { setError(null); setStep(to); }}>← Back</button>
  );

  return (
    <div ref={rootRef} style={S} className="mx-auto max-w-md p-4 text-gray-900" data-testid="booking-flow">
      {error && <div role="alert" className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm">{error}</div>}

      {step === "service" && (
        <div>
          {p.intro && <p className="text-sm text-gray-600 mb-4">{p.intro}</p>}
          <h2 className="font-semibold text-lg mb-3">What would you like to do?</h2>
          <div className="space-y-3">
            {p.services.map((s) => (
              <button key={s.id} className={btn} data-testid={`service-${s.id}`} onClick={() => pickService(s)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-sm text-gray-500 shrink-0">{s.duration_min} min{s.price_cents != null ? ` · ${price(s.price_cents)}` : ""}</span>
                </div>
                {s.description && <div className="text-sm text-gray-500 mt-1">{s.description}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "staff" && service && (
        <div>
          {back("service")}
          <h2 className="font-semibold text-lg mb-3">Who would you like?</h2>
          <div className="space-y-3">
            {service.staff.map((st) => (
              <button key={st.id} className={btn} data-testid={`staff-${st.id}`} onClick={() => pickStaff(st.id)}>
                <span className="font-medium">{st.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "time" && service && (
        <div>
          {back(service.staff.length > 1 ? "staff" : "service")}
          <h2 className="font-semibold text-lg mb-3">Pick a time <span className="text-sm font-normal text-gray-500">({service.name})</span></h2>
          {slotsError && <p className="text-sm text-red-700">Couldn&apos;t load times. Please refresh.</p>}
          {!slots && !slotsError && <p className="text-sm text-gray-500" data-testid="slots-loading">Loading times…</p>}
          {slots && days.length === 0 && <p className="text-sm text-gray-600">No times available right now — please check back soon.</p>}
          {days.length > 0 && (
            <div>
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3" data-testid="day-strip">
                {days.map((d, i) => (
                  <button key={d.key}
                    className={`px-3 py-2 rounded-lg border text-sm whitespace-nowrap ${i === dayIdx ? "bg-[var(--bh-color)] text-white border-transparent" : "border-gray-200 bg-white"}`}
                    onClick={() => setDayIdx(i)}>
                    {d.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2" data-testid="slot-grid">
                {days[dayIdx].slots.map((s) => (
                  <button key={s}
                    className={`py-2 rounded-lg border text-sm ${start === s ? "bg-[var(--bh-color)] text-white border-transparent" : "border-gray-200 bg-white"}`}
                    data-testid={`slot-${s}`}
                    onClick={() => { setStart(s); setStep("details"); }}>
                    {fmtTime(s, p.tz)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "event" && service && (
        <div>
          {back("service")}
          <h2 className="font-semibold text-lg mb-3">Choose a class <span className="text-sm font-normal text-gray-500">({service.name})</span></h2>
          {eventsError && <p className="text-sm text-red-700">Couldn&apos;t load classes. Please refresh.</p>}
          {!events && !eventsError && <p className="text-sm text-gray-500" data-testid="events-loading">Loading classes…</p>}
          {events && events.length === 0 && <p className="text-sm text-gray-600">No upcoming classes right now — please check back soon.</p>}
          <div className="space-y-3">
            {(events ?? []).map((ev) => {
              const full = ev.seatsLeft <= 0;
              return (
                <button key={ev.id} data-testid={`event-${ev.id}`}
                  className={`w-full text-left rounded-xl border p-4 ${full ? "border-gray-200 bg-gray-50 hover:border-amber-400" : "border-gray-200 bg-white hover:border-[var(--bh-color)]"}`}
                  onClick={() => { setChosenEvent(ev); setWaitlist(full); setStep("details"); }}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{fmtDay(ev.start, p.tz)} · {fmtTime(ev.start, p.tz)}</span>
                    <span className={`text-sm ${full ? "text-amber-700 font-medium" : ev.seatsLeft <= 3 ? "text-amber-700" : "text-gray-600"}`}>
                      {full ? "Full · join waitlist" : `${ev.seatsLeft} of ${ev.capacity} left`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === "details" && service && (start || chosenEvent) && (
        <div>
          {back(service.is_group ? "event" : "time")}
          <h2 className="font-semibold text-lg mb-1">Your details</h2>
          <p className="text-sm text-gray-600 mb-4">{service.name} — {fmtDay((service.is_group ? chosenEvent!.start : start!), p.tz)} at {fmtTime((service.is_group ? chosenEvent!.start : start!), p.tz)}</p>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <label className="block text-sm">Name<input required data-testid="in-name" className="mt-1 w-full rounded-lg border border-gray-300 p-2.5" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block text-sm">Phone<input required type="tel" data-testid="in-phone" className="mt-1 w-full rounded-lg border border-gray-300 p-2.5" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label className="block text-sm">Email<input required type="email" data-testid="in-email" className="mt-1 w-full rounded-lg border border-gray-300 p-2.5" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {service.location_mode === "address" && (
              <label className="block text-sm">Service address<input required data-testid="in-address" placeholder="Street, city, zip" className="mt-1 w-full rounded-lg border border-gray-300 p-2.5" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            )}
            {service.questions.map((q) => (
              <label key={q.id} className="block text-sm">{q.label}{q.required ? "" : " (optional)"}
                {q.type === "textarea" ? (
                  <textarea required={q.required} data-testid={`in-q-${q.id}`} className="mt-1 w-full rounded-lg border border-gray-300 p-2.5" rows={3}
                    value={intake[q.id] ?? ""} onChange={(e) => setIntake({ ...intake, [q.id]: e.target.value })} />
                ) : q.type === "select" && q.options ? (
                  <select required={q.required} data-testid={`in-q-${q.id}`} className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 bg-white"
                    value={intake[q.id] ?? ""} onChange={(e) => setIntake({ ...intake, [q.id]: e.target.value })}>
                    <option value="">Choose…</option>
                    {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : q.type === "file" ? (
                  <div className="mt-1">
                    <input type="file" accept="image/*,application/pdf" data-testid={`in-q-${q.id}`}
                      className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium"
                      onChange={(e) => handleFile(q.id, e.target.files?.[0])} />
                    {files[q.id]?.status === "up" && <p className="mt-1 text-xs text-gray-500">Uploading {files[q.id]?.name}…</p>}
                    {files[q.id]?.status === "done" && <p className="mt-1 text-xs text-emerald-600">✓ {files[q.id]?.name} attached</p>}
                    {files[q.id]?.status === "err" && <p className="mt-1 text-xs text-red-600">{files[q.id]?.msg}</p>}
                  </div>
                ) : (
                  <input required={q.required} data-testid={`in-q-${q.id}`} className="mt-1 w-full rounded-lg border border-gray-300 p-2.5"
                    value={intake[q.id] ?? ""} onChange={(e) => setIntake({ ...intake, [q.id]: e.target.value })} />
                )}
              </label>
            ))}
            {p.smsEnabled && (
              <label className="flex items-start gap-2 text-xs text-gray-600">
                <input type="checkbox" data-testid="in-sms" className="mt-0.5" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} />
                <span>It&apos;s OK to text me about this appointment (reminders &amp; updates). Reply STOP to opt out.</span>
              </label>
            )}
            <button type="submit" disabled={busy} data-testid="confirm-booking"
              className="w-full rounded-xl bg-[var(--bh-color)] text-white font-semibold py-3 disabled:opacity-50">
              {busy ? "Working…" : waitlist ? "Join the waitlist"
                : service.requires_payment && (service.deposit_cents ?? 0) > 0
                ? `Continue to deposit ($${((service.deposit_cents ?? 0) / 100).toFixed(0)})`
                : service.booking_mode === "request" ? "Request this time" : (service.is_group ? "Reserve my spot" : "Confirm booking")}
            </button>
            {service.requires_payment && (service.deposit_cents ?? 0) > 0 ? (
              <p className="text-center text-xs text-gray-500">A ${((service.deposit_cents ?? 0) / 100).toFixed(0)} deposit confirms your booking. Your time is held while you pay.</p>
            ) : service.booking_mode === "request" ? (
              <p className="text-center text-xs text-gray-500">{p.tenantName} will confirm your request by email — nothing is locked until they do.</p>
            ) : null}
          </form>
        </div>
      )}

      {step === "card" && service && protect && stripePromise && manageToken && (
        <div data-testid="card-step">
          <div className="mb-4 text-center">
            <div className="mx-auto mb-2 h-11 w-11 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xl">✓</div>
            <h2 className="font-semibold text-xl">You&apos;re {pending ? "requested" : "booked"}! One last step</h2>
            <p className="mt-1 text-sm text-gray-600">Save a card to hold your spot. <strong>Nothing is charged now</strong> — {p.tenantName} only charges a {money(protect.feeCents)} fee if you don&apos;t show up for your appointment.</p>
          </div>
          <Elements stripe={stripePromise}>
            <CardVaultForm clientSecret={protect.clientSecret} manageToken={manageToken} feeCents={protect.feeCents} onDone={() => setStep("done")} />
          </Elements>
          <button onClick={() => setStep("done")} data-testid="card-skip" className="mt-3 block w-full text-center text-xs text-gray-500 underline">Skip for now</button>
        </div>
      )}

      {step === "done" && service && doneStart !== null && pending && (
        <div className="text-center py-6" data-testid="booking-done">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl">⏳</div>
          <h2 className="font-semibold text-xl mb-1">Request sent!</h2>
          <p className="text-gray-600 mb-1">{service.name}</p>
          <p className="font-medium mb-4">{fmtDay(doneStart, p.tz)} at {fmtTime(doneStart, p.tz)}</p>
          <p className="text-sm text-gray-600 mb-4"><strong>{p.tenantName}</strong> will review and confirm. We&apos;ll email <strong>{email}</strong> the moment they do — nothing is locked in until then.</p>
          {manageToken && (
            <a className="block w-full rounded-xl border border-gray-300 py-2.5 text-sm font-medium" href={`/manage/${manageToken}`} data-testid="manage-link">View or withdraw request</a>
          )}
        </div>
      )}

      {step === "done" && service && waitlistDone && (
        <div className="text-center py-6" data-testid="waitlist-done">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl">⏳</div>
          <h2 className="font-semibold text-xl mb-1">You&apos;re on the waitlist</h2>
          <p className="text-gray-600 mb-1">{service.name}</p>
          {doneStart !== null && <p className="font-medium mb-4">{fmtDay(doneStart, p.tz)} at {fmtTime(doneStart, p.tz)}</p>}
          <p className="text-sm text-gray-600">If a spot opens up, we&apos;ll grab it for you and email <strong>{email}</strong> right away.</p>
        </div>
      )}

      {step === "done" && service && doneStart !== null && !pending && !waitlistDone && (
        <div className="text-center py-6" data-testid="booking-done">
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-2xl">✓</div>
          <h2 className="font-semibold text-xl mb-1">{service.is_group ? "Your spot is reserved!" : "You’re booked!"}</h2>
          <p className="text-gray-600 mb-1">{service.name}</p>
          <p className="font-medium mb-4">{fmtDay(doneStart, p.tz)} at {fmtTime(doneStart, p.tz)}</p>
          <p className="text-sm text-gray-600 mb-4">A confirmation email with a calendar invite is on its way to <strong>{email}</strong>.</p>
          {manageToken && (
            <div className="space-y-2">
              <a className="block w-full rounded-xl border border-gray-300 py-2.5 text-sm font-medium" href={`/api/booking-ics/${manageToken}`} data-testid="add-to-calendar">Add to my calendar (.ics)</a>
              <a className="block w-full rounded-xl border border-gray-300 py-2.5 text-sm font-medium" href={`/manage/${manageToken}`} data-testid="manage-link">{service.is_group ? "View or cancel" : "Reschedule or cancel"}</a>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-[11px] text-gray-500">Powered by {p.tenantName}{SHOW_ATTRIBUTION ? ` · scheduling by ${APP_NAME}` : ""}</p>
    </div>
  );
}
