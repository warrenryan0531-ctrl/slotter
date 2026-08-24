// Pure slot engine. All inputs explicit; unit-testable with no I/O.
import { addDays, dateInTz, isoDate, wallToUtc } from "./tz";

export type Interval = { start: number; end: number }; // UTC ms, [start, end)

export type SlotInput = {
  tz: string;
  now: number;                    // UTC ms
  rangeDays: number;              // how many calendar days ahead to generate
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  granularityMin: number;
  minNoticeHours: number;
  maxAdvanceDays: number;
  rules: { weekday: number; start_min: number; end_min: number }[];
  overrides: { date: string; closed: boolean; start_min: number | null; end_min: number | null }[];
  busy: Interval[];               // buffer-inclusive booking timespans + blocks, UTC
};

export type Slot = { start: number; end: number }; // customer-visible times, UTC ms

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function generateSlots(inp: SlotInput): Slot[] {
  const out: Slot[] = [];
  const durMs = inp.durationMin * 60000;
  const bufB = inp.bufferBeforeMin * 60000;
  const bufA = inp.bufferAfterMin * 60000;
  const notBefore = inp.now + inp.minNoticeHours * 3600000;
  const notAfter = inp.now + inp.maxAdvanceDays * 86400000;
  const overrideMap = new Map(inp.overrides.map((o) => [o.date, o]));

  const today = dateInTz(inp.now, inp.tz);
  for (let i = 0; i <= inp.rangeDays; i++) {
    const day = i === 0 ? today : addDays(today, i);
    const key = isoDate(day);
    const ov = overrideMap.get(key);
    let windows: { start_min: number; end_min: number }[];
    if (ov) {
      if (ov.closed || ov.start_min == null || ov.end_min == null) continue;
      windows = [{ start_min: ov.start_min, end_min: ov.end_min }];
    } else {
      windows = inp.rules.filter((r) => r.weekday === day.weekday);
    }
    for (const w of windows) {
      // candidate customer start minutes; buffers must fit inside the window
      for (let m = w.start_min + inp.bufferBeforeMin; m + inp.durationMin + inp.bufferAfterMin <= w.end_min; m += inp.granularityMin) {
        const startUtc = wallToUtc({ y: day.y, m: day.m, d: day.d, hh: Math.floor(m / 60), mm: m % 60 }, inp.tz);
        if (startUtc === null) continue; // nonexistent (DST spring-forward): skip
        const end = startUtc + durMs;
        if (startUtc < notBefore || startUtc > notAfter) continue;
        const busySpan: Interval = { start: startUtc - bufB, end: end + bufA };
        if (inp.busy.some((b) => overlaps(b, busySpan))) continue;
        out.push({ start: startUtc, end });
      }
    }
  }
  out.sort((a, b) => a.start - b.start);
  // de-dup (overlapping rules can double-produce a start)
  return out.filter((s, i) => i === 0 || s.start !== out[i - 1].start);
}

/** Membership check used by the confirm endpoint (server-side revalidation). */
export function isValidSlotStart(inp: SlotInput, startUtc: number): boolean {
  return generateSlots(inp).some((s) => s.start === startUtc);
}
