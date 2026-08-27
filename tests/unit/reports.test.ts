import { describe, it, expect, vi } from "vitest";

// db() returns our fixed booking rows regardless of the query chain; repo supplies name maps.
const state = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("../../lib/db", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q; q.gte = () => q; q.lt = () => q; q.order = () => q;
  q.limit = () => Promise.resolve({ data: state.rows });
  return { db: () => ({ from: () => q }) };
});
vi.mock("../../lib/repo", () => ({
  allServices: async () => [{ id: "s1", name: "Haircut" }, { id: "s2", name: "Beard" }],
  staffForTenant: async () => [{ id: "st1", name: "Sam" }],
}));

import { computeReport, defaultRange } from "../../lib/reports";

function bk(o: Record<string, unknown>) {
  return { id: "x", tenant_id: "t1", service_id: "s1", staff_id: "st1", customer: { name: "C", phone: "", email: "" }, status: "confirmed", no_show: false, payment_status: "none", deposit_cents: null, fee_charged_cents: null, ...o };
}
const TZ = "America/New_York";

describe("computeReport", () => {
  it("aggregates totals, revenue, no-show rate, per-day (with tz bucketing) and per-service/staff", async () => {
    state.rows = [
      bk({ id: "b1", starts_at: "2026-08-01T14:00:00Z", status: "confirmed", payment_status: "paid", deposit_cents: 2000, service_id: "s1" }), // Aug 1 ET
      bk({ id: "b2", starts_at: "2026-08-01T20:00:00Z", status: "confirmed", no_show: true, fee_charged_cents: 2500, service_id: "s1" }),        // Aug 1 ET, no-show, fee
      bk({ id: "b3", starts_at: "2026-08-02T13:00:00Z", status: "cancelled", service_id: "s2" }),                                                // Aug 2 ET, cancelled
      bk({ id: "b4", starts_at: "2026-08-03T02:00:00Z", status: "confirmed", payment_status: "paid", deposit_cents: 3000, service_id: "s2" }),  // 10pm ET Aug 2 → buckets Aug 2
    ];
    const r = await computeReport("t1", "2026-08-01", "2026-08-03", TZ);

    expect(r.totals.confirmed).toBe(3);
    expect(r.totals.cancelled).toBe(1);
    expect(r.totals.noShows).toBe(1);
    expect(r.totals.noShowRate).toBeCloseTo(1 / 3, 5);
    expect(r.totals.revenueCents).toBe(7500); // 2000 + 2500 + 3000

    const day = (d: string) => r.byDay.find((x) => x.date === d)!;
    expect(r.byDay).toHaveLength(3);
    expect(day("2026-08-01")).toMatchObject({ bookings: 2, revenueCents: 4500, noShows: 1 });
    expect(day("2026-08-02")).toMatchObject({ bookings: 1, revenueCents: 3000, noShows: 0 }); // b4 crossed midnight into Aug 2 ET
    expect(day("2026-08-03")).toMatchObject({ bookings: 0, revenueCents: 0 });

    expect(r.byService.find((s) => s.id === "s1")).toMatchObject({ name: "Haircut", bookings: 2, revenueCents: 4500 });
    expect(r.byService.find((s) => s.id === "s2")).toMatchObject({ name: "Beard", bookings: 1, revenueCents: 3000 });
    expect(r.byStaff[0]).toMatchObject({ name: "Sam", bookings: 3 });
    expect(r.rows).toHaveLength(4); // confirmed + cancelled (excludes none here)
  });

  it("excludes pending and declined from counts", async () => {
    state.rows = [
      bk({ id: "p", starts_at: "2026-08-01T15:00:00Z", status: "pending" }),
      bk({ id: "d", starts_at: "2026-08-01T16:00:00Z", status: "declined" }),
      bk({ id: "c", starts_at: "2026-08-01T17:00:00Z", status: "confirmed" }),
    ];
    const r = await computeReport("t1", "2026-08-01", "2026-08-01", TZ);
    expect(r.totals.confirmed).toBe(1);
    expect(r.rows).toHaveLength(1); // only the confirmed row
  });

  it("empty range → zeroed grid, no divide-by-zero", async () => {
    state.rows = [];
    const r = await computeReport("t1", "2026-08-01", "2026-08-02", TZ);
    expect(r.totals.confirmed).toBe(0);
    expect(r.totals.noShowRate).toBe(0);
    expect(r.byDay).toHaveLength(2);
  });

  it("rejects a malformed range", async () => {
    await expect(computeReport("t1", "not-a-date", "2026-08-01", TZ)).rejects.toThrow();
  });

  it("defaultRange spans 30 inclusive days", () => {
    const { from, to } = defaultRange(TZ, Date.parse("2026-08-30T12:00:00Z"));
    expect(to).toBe("2026-08-30");
    expect(from).toBe("2026-08-01");
  });
});
