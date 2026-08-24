import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calendarAdapter, type CalConnection } from "../../lib/services/calendar";

const future = new Date(Date.now() + 3600_000).toISOString();
const conn: CalConnection = { id: "m1", provider: "microsoft", externalCalendarId: null, accessToken: "tok", refreshToken: "ref", tokenExpiry: future };
const m = calendarAdapter("microsoft");

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("MicrosoftCalendar.busy", () => {
  it("reads calendarView, excludes cancelled/free/own events, returns UTC intervals", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { value: [
      { isCancelled: false, showAs: "busy", start: { dateTime: "2026-09-07T17:00:00.0000000" }, end: { dateTime: "2026-09-07T18:00:00.0000000" }, singleValueExtendedProperties: [] },
      { isCancelled: false, showAs: "free", start: { dateTime: "2026-09-07T19:00:00.0000000" }, end: { dateTime: "2026-09-07T20:00:00.0000000" } }, // free → ignored
      { isCancelled: false, showAs: "busy", start: { dateTime: "2026-09-07T20:00:00.0000000" }, end: { dateTime: "2026-09-07T21:00:00.0000000" }, singleValueExtendedProperties: [{ value: "bk1" }] }, // ours → ignored
      { isCancelled: true, start: { dateTime: "2026-09-07T21:00:00.0000000" }, end: { dateTime: "2026-09-07T22:00:00.0000000" } }, // cancelled → ignored
    ] }));
    const busy = await m.busy(conn, Date.parse("2026-09-07T00:00:00Z"), Date.parse("2026-09-08T00:00:00Z"));
    expect(busy).toEqual([{ start: Date.parse("2026-09-07T17:00:00Z"), end: Date.parse("2026-09-07T18:00:00Z") }]);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/me/calendarView");
    expect(url).toContain("singleValueExtendedProperties");
    expect(fetchMock.mock.calls[0][1].headers.Prefer).toContain("UTC");
  });
});

describe("MicrosoftCalendar.upsertEvent", () => {
  it("POSTs an event with the marker extended property", async () => {
    fetchMock.mockResolvedValueOnce(res(201, { id: "AAMk" }));
    const id = await m.upsertEvent(conn, { bookingId: "bk9", title: "Consult", start: Date.parse("2026-09-07T17:00:00Z"), end: Date.parse("2026-09-07T18:00:00Z") });
    expect(id).toBe("AAMk");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.singleValueExtendedProperties[0].value).toBe("bk9");
    expect(body.start.timeZone).toBe("UTC");
  });
});

describe("MicrosoftCalendar.ensureFreshToken", () => {
  it("refreshes at the MS token endpoint when expired", async () => {
    process.env.MS_OAUTH_CLIENT_ID = "id"; process.env.MS_OAUTH_CLIENT_SECRET = "secret";
    fetchMock.mockResolvedValueOnce(res(200, { access_token: "new", expires_in: 3600 }));
    const expired: CalConnection = { ...conn, tokenExpiry: new Date(Date.now() - 1000).toISOString() };
    const r = await m.ensureFreshToken(expired);
    expect(r?.accessToken).toBe("new");
    expect(fetchMock.mock.calls[0][0]).toContain("login.microsoftonline.com");
  });
});
