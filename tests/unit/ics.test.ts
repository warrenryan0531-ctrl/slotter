import { describe, it, expect } from "vitest";
import { buildIcs, buildFeed } from "../../lib/ics";

describe("ics", () => {
  const ev = {
    uid: "abc@example.test", sequence: 2, method: "REQUEST" as const,
    start: Date.parse("2026-09-01T14:00:00Z"), end: Date.parse("2026-09-01T15:00:00Z"),
    summary: "Full Detail — Jordan Avery",
    description: "Line1\nLine2, with comma; and semicolon",
    location: "1284 Atlantic Blvd, Jacksonville",
    organizerName: "Coastal Shine", organizerEmail: "bookings@x.test",
    attendees: [{ name: "Jordan", email: "j@example.com" }],
    stampNow: Date.parse("2026-08-18T12:00:00Z"),
  };

  it("emits valid iTIP REQUEST with sequence and UTC times", () => {
    const t = buildIcs(ev);
    expect(t).toContain("METHOD:REQUEST");
    expect(t).toContain("SEQUENCE:2");
    expect(t).toContain("DTSTART:20260901T140000Z");
    expect(t).toContain("DTEND:20260901T150000Z");
    expect(t).toContain("UID:abc@example.test");
    expect(t).toContain("STATUS:CONFIRMED");
    expect(t.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(t).toContain("\\n"); // newline escaped
    expect(t).toContain("with comma\\;"); // ; escaped... (comma+semicolon escapes present)
  });

  it("CANCEL carries CANCELLED status", () => {
    const t = buildIcs({ ...ev, method: "CANCEL", sequence: 3 });
    expect(t).toContain("METHOD:CANCEL");
    expect(t).toContain("SEQUENCE:3");
    expect(t).toContain("STATUS:CANCELLED");
  });

  it("lines fold at 75 octets and use CRLF", () => {
    const t = buildIcs({ ...ev, summary: "X".repeat(200) });
    for (const line of t.split("\r\n")) expect(line.length).toBeLessThanOrEqual(75);
    expect(t.includes("\n") && !t.includes("\r\n")).toBe(false);
  });

  it("feed contains all events", () => {
    const f = buildFeed("Test — Bookings", [
      { uid: "a@x", sequence: 0, start: ev.start, end: ev.end, summary: "One", stampNow: ev.stampNow },
      { uid: "b@x", sequence: 1, start: ev.start, end: ev.end, summary: "Two", stampNow: ev.stampNow },
    ]);
    expect(f.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(f).toContain("X-WR-CALNAME:Test — Bookings");
  });
});
