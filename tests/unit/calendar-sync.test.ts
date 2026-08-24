import { describe, it, expect } from "vitest";
import { generateSlots, type SlotInput } from "../../lib/engine/slots";
import { calendarAdapter } from "../../lib/services/calendar";

// A Monday 9–5 America/New_York schedule.
function baseInput(extraBusy: { start: number; end: number }[] = []): SlotInput {
  const now = Date.parse("2026-09-07T08:00:00Z"); // a Monday morning
  return {
    tz: "America/New_York", now, rangeDays: 1,
    durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, granularityMin: 60,
    minNoticeHours: 0, maxAdvanceDays: 2,
    rules: [{ weekday: 1, start_min: 540, end_min: 1020 }], // Mon 9:00–17:00
    overrides: [],
    busy: extraBusy,
  };
}

describe("external calendar busy blocks slots (FR-E1.2)", () => {
  it("removes exactly the slot an external busy interval overlaps", () => {
    const withoutSync = generateSlots(baseInput());
    // Owner is busy 13:00–14:00 ET on that Monday = 17:00–18:00 UTC.
    const busyStart = Date.parse("2026-09-07T17:00:00Z");
    const withSync = generateSlots(baseInput([{ start: busyStart, end: busyStart + 3600000 }]));
    expect(withoutSync.some((s) => s.start === busyStart)).toBe(true);   // offered before sync
    expect(withSync.some((s) => s.start === busyStart)).toBe(false);      // blocked after sync
    expect(withSync.length).toBe(withoutSync.length - 1);                 // only that one removed
  });
});

describe("demo calendar adapter", () => {
  it("reports a busy block per day and no-ops on push", async () => {
    const demo = calendarAdapter("demo");
    const from = Date.parse("2026-09-07T00:00:00Z");
    const to = Date.parse("2026-09-09T00:00:00Z"); // 2 days
    const busy = await demo.busy({ id: "x", provider: "demo", externalCalendarId: null, accessToken: null, refreshToken: null, tokenExpiry: null }, from, to);
    expect(busy.length).toBe(2);
    for (const b of busy) expect(b.end - b.start).toBe(3600000); // 1h blocks
    const id = await demo.upsertEvent({ id: "x", provider: "demo", externalCalendarId: null, accessToken: null, refreshToken: null, tokenExpiry: null }, { bookingId: "bk1", title: "t", start: from, end: to });
    expect(id).toContain("bk1");
  });
});
