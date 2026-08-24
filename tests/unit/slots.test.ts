import { describe, it, expect } from "vitest";
import { generateSlots, type SlotInput } from "../../lib/engine/slots";
import { wallToUtc, wallToUtcAll } from "../../lib/engine/tz";

const NY = "America/New_York";

function base(now: number): SlotInput {
  return {
    tz: NY, now, rangeDays: 7,
    durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0,
    granularityMin: 30, minNoticeHours: 0, maxAdvanceDays: 30,
    rules: [], overrides: [], busy: [],
  };
}

describe("tz conversion (DST pins per resolution #6)", () => {
  it("normal day round-trips", () => {
    const utc = wallToUtc({ y: 2026, m: 6, d: 15, hh: 9, mm: 0 }, NY);
    expect(utc).toBe(Date.parse("2026-06-15T13:00:00Z")); // EDT = UTC-4
  });
  it("spring-forward 2026-03-08: 2:30 AM does not exist → null", () => {
    expect(wallToUtc({ y: 2026, m: 3, d: 8, hh: 2, mm: 30 }, NY)).toBeNull();
  });
  it("fall-back 2026-11-01: 1:30 AM is ambiguous → first occurrence (EDT)", () => {
    const all = wallToUtcAll({ y: 2026, m: 11, d: 1, hh: 1, mm: 30 }, NY);
    expect(all.length).toBe(2);
    expect(wallToUtc({ y: 2026, m: 11, d: 1, hh: 1, mm: 30 }, NY)).toBe(Date.parse("2026-11-01T05:30:00Z")); // EDT = UTC-4
  });
});

describe("generateSlots", () => {
  // Mon 2026-06-15, generating for that week
  const now = Date.parse("2026-06-15T10:00:00Z"); // 6 AM ET Monday

  it("tiles a window at granularity and respects duration", () => {
    const inp = { ...base(now), rules: [{ weekday: 1, start_min: 540, end_min: 720 }] }; // Mon 9:00–12:00
    const slots = generateSlots(inp).filter((s) => new Date(s.start).getUTCDate() === 15);
    // 9:00, 9:30, 10:00, 10:30, 11:00 (11:30+60 > 12:00)
    expect(slots.length).toBe(5);
    expect(slots[0].start).toBe(Date.parse("2026-06-15T13:00:00Z"));
    expect(slots[4].start).toBe(Date.parse("2026-06-15T15:00:00Z"));
  });

  it("buffers must fit inside the window and extend the busy footprint", () => {
    const inp = {
      ...base(now),
      bufferBeforeMin: 30, bufferAfterMin: 30,
      rules: [{ weekday: 1, start_min: 540, end_min: 720 }],
    };
    const slots = generateSlots(inp).filter((s) => new Date(s.start).getUTCDate() === 15);
    // earliest start 9:30 (30m prep), latest 10:30 (60+30 after ≤ 12:00)
    expect(slots[0].start).toBe(Date.parse("2026-06-15T13:30:00Z"));
    expect(slots[slots.length - 1].start).toBe(Date.parse("2026-06-15T14:30:00Z"));
  });

  it("busy intervals (incl. buffered bookings) remove slots", () => {
    const inp = {
      ...base(now),
      rules: [{ weekday: 1, start_min: 540, end_min: 720 }],
      busy: [{ start: Date.parse("2026-06-15T13:30:00Z"), end: Date.parse("2026-06-15T14:30:00Z") }],
    };
    const starts = generateSlots(inp).filter((s) => new Date(s.start).getUTCDate() === 15).map((s) => s.start);
    expect(starts).not.toContain(Date.parse("2026-06-15T13:00:00Z")); // 9:00 overlaps 9:30 busy
    expect(starts).not.toContain(Date.parse("2026-06-15T14:00:00Z")); // 10:00 inside busy
    expect(starts).toContain(Date.parse("2026-06-15T14:30:00Z"));     // 10:30 clear
  });

  it("min-notice and closed overrides filter slots", () => {
    const inp = {
      ...base(now), minNoticeHours: 5, // now = 6 AM ET → nothing before 11 AM ET
      rules: [{ weekday: 1, start_min: 540, end_min: 720 }, { weekday: 2, start_min: 540, end_min: 720 }],
      overrides: [{ date: "2026-06-16", closed: true, start_min: null, end_min: null }],
    };
    const slots = generateSlots(inp);
    const monday = slots.filter((s) => new Date(s.start).getUTCDate() === 15);
    expect(monday[0].start).toBe(Date.parse("2026-06-15T15:00:00Z")); // 11:00 ET
    expect(slots.some((s) => new Date(s.start).getUTCDate() === 16)).toBe(false); // Tue closed
  });

  it("spring-forward day: nonexistent 2:00–3:00 slots are skipped, count is exact", () => {
    // Sunday 2026-03-08, window 1:00–4:00 AM, 30-min slots of 30-min duration
    const inp = {
      ...base(Date.parse("2026-03-07T12:00:00Z")),
      durationMin: 30,
      rules: [{ weekday: 0, start_min: 60, end_min: 240 }],
    };
    const slots = generateSlots(inp).filter((s) => {
      const d = new Date(s.start);
      return d.getUTCMonth() === 2 && (d.getUTCDate() === 8);
    });
    // wall starts: 1:00, 1:30, (2:00, 2:30 skipped — nonexistent), 3:00, 3:30 → 4 slots
    expect(slots.length).toBe(4);
  });

  it("fall-back day: ambiguous 1:00–2:00 resolves to first occurrence only (no duplicates)", () => {
    const inp = {
      ...base(Date.parse("2026-10-31T12:00:00Z")),
      durationMin: 30,
      rules: [{ weekday: 0, start_min: 60, end_min: 180 }], // Sun 1:00–3:00
    };
    const slots = generateSlots(inp).filter((s) => new Date(s.start).getUTCMonth() === 10 || (new Date(s.start).getUTCMonth() === 9 && new Date(s.start).getUTCDate() === 31));
    const starts = slots.map((s) => s.start);
    expect(new Set(starts).size).toBe(starts.length); // no dupes
    // 1:00 EDT = 05:00Z (first occurrence chosen, not 06:00Z)
    expect(starts).toContain(Date.parse("2026-11-01T05:00:00Z"));
    expect(starts).not.toContain(Date.parse("2026-11-01T06:00:00Z"));
  });
});
