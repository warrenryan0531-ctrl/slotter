// Pure timezone math via Intl — no deps.
// DST policy (review resolution #6): nonexistent wall-clock minutes are SKIPPED;
// ambiguous minutes resolve to the FIRST occurrence (earlier UTC instant).

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export type Wall = { y: number; m: number; d: number; hh: number; mm: number };

export function wallAt(utcMs: number, tz: string): Wall {
  const parts = fmt(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const hh = get("hour");
  return { y: get("year"), m: get("month"), d: get("day"), hh: hh === 24 ? 0 : hh, mm: get("minute") };
}

function offsetAt(utcMs: number, tz: string): number {
  const w = wallAt(utcMs, tz);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, 0);
  // strip seconds from utcMs for comparison
  const base = Math.floor(utcMs / 60000) * 60000;
  return asUtc - base;
}

/** All UTC instants whose wall clock in tz equals the given wall time. [] = nonexistent, 2 = ambiguous. */
export function wallToUtcAll(w: Wall, tz: string): number[] {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm, 0);
  const offs = new Set([
    offsetAt(guess - 86400000, tz),
    offsetAt(guess, tz),
    offsetAt(guess + 86400000, tz),
  ]);
  const out: number[] = [];
  for (const off of offs) {
    const cand = guess - off;
    const back = wallAt(cand, tz);
    if (back.y === w.y && back.m === w.m && back.d === w.d && back.hh === w.hh && back.mm === w.mm) out.push(cand);
  }
  return out.sort((a, b) => a - b);
}

/** Policy-applied conversion: null when the wall time doesn't exist; first occurrence when ambiguous. */
export function wallToUtc(w: Wall, tz: string): number | null {
  const all = wallToUtcAll(w, tz);
  return all.length === 0 ? null : all[0];
}

/** Calendar date (in tz) for a UTC instant, as {y,m,d} + weekday 0=Sunday. */
export function dateInTz(utcMs: number, tz: string): { y: number; m: number; d: number; weekday: number } {
  const w = wallAt(utcMs, tz);
  // weekday from the wall date interpreted as UTC (safe: weekday is a pure calendar fn)
  const weekday = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay();
  return { y: w.y, m: w.m, d: w.d, weekday };
}

export function addDays(d: { y: number; m: number; d: number }, n: number): { y: number; m: number; d: number; weekday: number } {
  const t = Date.UTC(d.y, d.m - 1, d.d) + n * 86400000;
  const x = new Date(t);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), weekday: x.getUTCDay() };
}

export function isoDate(d: { y: number; m: number; d: number }): string {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

export function fmtInTz(utcMs: number, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }).format(new Date(utcMs));
}
