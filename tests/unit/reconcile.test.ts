import { describe, it, expect } from "vitest";
import { needsReconcile } from "../../lib/calendar";

describe("needsReconcile (H4 orphan selection)", () => {
  it("flags cancelled/declined bookings that still hold external refs", () => {
    expect(needsReconcile("cancelled", { conn1: "evt_1" })).toBe(true);
    expect(needsReconcile("declined", { conn1: "evt_1" })).toBe(true);
  });
  it("ignores active bookings and empty/absent refs", () => {
    expect(needsReconcile("confirmed", { conn1: "evt_1" })).toBe(false); // still active — keep the event
    expect(needsReconcile("cancelled", {})).toBe(false);                  // nothing to clean
    expect(needsReconcile("cancelled", null)).toBe(false);
    expect(needsReconcile("pending", { conn1: "evt_1" })).toBe(false);
  });
});
