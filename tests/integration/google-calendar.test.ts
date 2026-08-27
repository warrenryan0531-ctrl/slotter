import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calendarAdapter, type CalConnection } from "../../lib/services/calendar";

// Verifies the Google adapter builds the right requests, parses freebusy, filters its OWN
// events (R3), and refreshes tokens — against Google Calendar API's documented shapes, with
// fetch mocked. Turns "written to spec" into "verified against spec" without a live account.

const future = new Date(Date.now() + 3600_000).toISOString();
const conn: CalConnection = { id: "c1", provider: "google", externalCalendarId: "primary", accessToken: "tok", refreshToken: "ref", tokenExpiry: future };
const g = calendarAdapter("google");

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("GoogleCalendar.busy", () => {
  it("lists events in range and returns busy intervals, excluding our own + free/transparent", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { items: [
      { status: "confirmed", start: { dateTime: "2026-09-07T17:00:00Z" }, end: { dateTime: "2026-09-07T18:00:00Z" } },
      { status: "confirmed", transparency: "transparent", start: { dateTime: "2026-09-07T19:00:00Z" }, end: { dateTime: "2026-09-07T20:00:00Z" } }, // free → ignored
      { status: "confirmed", extendedProperties: { private: { slotterBookingId: "bk1" } }, start: { dateTime: "2026-09-07T20:00:00Z" }, end: { dateTime: "2026-09-07T21:00:00Z" } }, // ours → ignored (R3)
      { status: "cancelled", start: { dateTime: "2026-09-07T21:00:00Z" }, end: { dateTime: "2026-09-07T22:00:00Z" } }, // cancelled → ignored
    ] }));
    const from = Date.parse("2026-09-07T00:00:00Z"), to = Date.parse("2026-09-08T00:00:00Z");
    const busy = await g.busy(conn, from, to);
    expect(busy).toEqual([{ start: Date.parse("2026-09-07T17:00:00Z"), end: Date.parse("2026-09-07T18:00:00Z") }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/calendars/primary/events");
    expect(url).toContain("singleEvents=true");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValueOnce(res(401, {}));
    await expect(g.busy(conn, 0, 1)).rejects.toThrow(/events.list failed: 401/);
  });
});

describe("GoogleCalendar.upsertEvent", () => {
  it("POSTs a new event with our marker and returns the id", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: "evt_new" }));
    const r = await g.upsertEvent(conn, { bookingId: "bk9", title: "Cut", start: Date.parse("2026-09-07T17:00:00Z"), end: Date.parse("2026-09-07T18:00:00Z") });
    expect(r.id).toBe("evt_new");
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body).extendedProperties.private.slotterBookingId).toBe("bk9");
  });

  it("requests a Meet link for a video event and returns hangoutLink (B1)", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: "evt_v", hangoutLink: "https://meet.google.com/abc-defg-hij" }));
    const r = await g.upsertEvent(conn, { bookingId: "bkv", title: "Consult", start: 0, end: 1, video: true });
    expect(r.id).toBe("evt_v");
    expect(r.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("conferenceDataVersion=1");
    expect(JSON.parse(opts.body).conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });

  it("PATCHes when an existing id is passed", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: "evt_x" }));
    await g.upsertEvent(conn, { bookingId: "bk9", title: "Cut", start: 0, end: 1 }, "evt_x");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[0][0]).toContain("/events/evt_x");
  });
});

describe("GoogleCalendar.deleteEvent", () => {
  it("tolerates 404/410 (already gone) but throws on 500", async () => {
    fetchMock.mockResolvedValueOnce(res(404, {}));
    await expect(g.deleteEvent(conn, "gone")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res(500, {}));
    await expect(g.deleteEvent(conn, "x")).rejects.toThrow(/delete failed: 500/);
  });
});

describe("GoogleCalendar.ensureFreshToken", () => {
  it("refreshes when expired and returns new material", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "id"; process.env.GOOGLE_OAUTH_CLIENT_SECRET = "secret";
    fetchMock.mockResolvedValueOnce(res(200, { access_token: "new_tok", expires_in: 3600 }));
    const expired: CalConnection = { ...conn, tokenExpiry: new Date(Date.now() - 1000).toISOString() };
    const r = await g.ensureFreshToken(expired);
    expect(r?.accessToken).toBe("new_tok");
    expect(fetchMock.mock.calls[0][0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("returns null when the token is still fresh", async () => {
    expect(await g.ensureFreshToken(conn)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
