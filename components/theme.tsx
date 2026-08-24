"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCENTS, BACKGROUNDS, type ThemeScope } from "@/lib/prefs";

function Check({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Live theme picker. Writes the choice to /api/prefs (persisted per user), and updates the
 * dashboard shell's data-accent / data-bg attributes immediately for instant preview.
 */
export function ThemePicker({ scope, accent, background }: { scope: ThemeScope; accent: string; background: string }) {
  const router = useRouter();
  const [a, setA] = useState(accent);
  const [bg, setBg] = useState(background);
  const [busy, setBusy] = useState(false);

  function preview(attr: "accent" | "bg", val: string) {
    // The shell root carries both attributes; update it in place so the whole UI recolors now.
    const el = document.querySelector<HTMLElement>("[data-accent][data-bg]");
    if (el) el.setAttribute(`data-${attr}`, val);
  }

  async function save(patch: { accent?: string; background?: string }) {
    setBusy(true);
    try {
      await fetch("/api/prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, ...patch }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <span className="label">Accent — menu, pills &amp; buttons</span>
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Accent color">
          {ACCENTS.map((o) => {
            const on = a === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={o.label}
                title={o.label}
                disabled={busy}
                onClick={() => { setA(o.key); preview("accent", o.key); save({ accent: o.key }); }}
                className="grid h-9 w-9 place-items-center rounded-full text-white transition"
                style={{ backgroundColor: o.swatch, boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${o.swatch}` : undefined }}
              >
                {on && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="label">Background</span>
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Background color">
          {BACKGROUNDS.map((o) => {
            const on = bg === o.key;
            return (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={o.label}
                title={o.label}
                disabled={busy}
                onClick={() => { setBg(o.key); preview("bg", o.key); save({ background: o.key }); }}
                className="grid h-9 w-9 place-items-center rounded-full border border-[#d3ddd8] text-[#334155] transition"
                style={{ backgroundColor: o.swatch, boxShadow: on ? "0 0 0 2px #fff, 0 0 0 4px #334155" : undefined }}
              >
                {on && <Check className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Booking-page brand color — the color customers actually see on /b/<slug> and the embed
 * (drives every button, selected day, and time slot in the booking flow). Saved to the tenant's
 * branding via update_branding. Presets mirror the accent palette; a custom hex is also allowed.
 */
export function BookingColorPicker({ current }: { current: string }) {
  const router = useRouter();
  const [val, setVal] = useState(current || "#006778");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function apply(color: string) {
    setVal(color);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_branding", color }),
      });
      setSaved(true);
      router.refresh();
    }, 450);
  }

  const isPreset = ACCENTS.some((a) => a.swatch.toLowerCase() === val.toLowerCase());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5" role="radiogroup" aria-label="Booking page color">
        {ACCENTS.map((o) => {
          const on = o.swatch.toLowerCase() === val.toLowerCase();
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={o.label}
              title={o.label}
              onClick={() => apply(o.swatch)}
              className="grid h-9 w-9 place-items-center rounded-full text-white transition"
              style={{ backgroundColor: o.swatch, boxShadow: on ? `0 0 0 2px #fff, 0 0 0 4px ${o.swatch}` : undefined }}
            >
              {on && <Check className="h-4 w-4" />}
            </button>
          );
        })}
        {/* Custom hex */}
        <label
          title="Custom color"
          className="relative grid h-9 w-9 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#d3ddd8] text-[10px] font-bold text-[#64726b]"
          style={!isPreset ? { backgroundColor: val, color: "#fff", boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${val}` } : undefined}
        >
          {isPreset ? "＋" : <Check className="h-4 w-4" />}
          <input type="color" value={val} onChange={(e) => apply(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label="Custom color" />
        </label>
      </div>

      {/* Live preview of what customers see */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[#fafcfb] p-3">
        <span className="rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: val }}>Book</span>
        <span className="rounded-lg px-3 py-1.5 text-sm text-white" style={{ background: val }}>10:30 AM</span>
        <span className="ml-1 text-xs text-[#64726b]">how your booking buttons look · <span className="font-mono">{val}</span>{saved ? " · saved ✓" : ""}</span>
      </div>
    </div>
  );
}
