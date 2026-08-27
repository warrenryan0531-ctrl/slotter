import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the db layer: bh_meeting_connections lookups + token-refresh persistence.
const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
}));
vi.mock("../../lib/db", () => {
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q;
  q.limit = () => Promise.resolve({ data: state.row ? [state.row] : [] });
  q.update = (patch: Record<string, unknown>) => ({ eq: () => { state.updates.push(patch); return Promise.resolve({ error: null }); } });
  return { db: () => ({ from: () => q }) };
});
// Identity "encryption" so the adapter's decrypt calls read our fixture tokens directly.
vi.mock("../../lib/crypto", () => ({
  encryptSecret: (s: string | null) => s,
  decryptSecret: (s: string | null) => s,
}));

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;

function conn(over: Record<string, unknown> = {}) {
  return {
    id: "mc1", staff_id: "st1", provider: "zoom", account_email: "owner@x.com",
    access_token_enc: "at_valid", refresh_token_enc: "rt_1",
    token_expiry: new Date(Date.now() + 3600_000).toISOString(), active: true, ...over,
  };
}

beforeEach(() => {
  state.row = conn(); state.updates = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  Object.assign(process.env, { ZOOM_CLIENT_ID: "zid", ZOOM_CLIENT_SECRET: "zsecret", APP_SECRET: "s" });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("createZoomMeeting", () => {
  it("POSTs to /users/me/meetings with bearer token and returns join_url + id", async () => {
    fetchMock.mockResolvedValueOnce(res(201, { id: 987654321, join_url: "https://zoom.us/j/987654321?pwd=abc" }));
    const { createZoomMeeting } = await import("../../lib/meetings");
    const m = await createZoomMeeting("st1", { topic: "Consult — Pat (Shop)", startMs: Date.parse("2026-09-01T15:00:00Z"), durationMin: 30, bookingId: "b1", tz: "America/New_York" });
    expect(m).toEqual({ joinUrl: "https://zoom.us/j/987654321?pwd=abc", meetingId: "987654321" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.zoom.us/v2/users/me/meetings");
    expect(opts.headers.Authorization).toBe("Bearer at_valid");
    const body = JSON.parse(opts.body);
    expect(body.type).toBe(2);
    expect(body.start_time).toBe("2026-09-01T15:00:00.000Z");
    expect(body.duration).toBe(30);
    expect(body.timezone).toBe("America/New_York");
  });

  it("refreshes an expired token first (Basic auth, rotated refresh token persisted)", async () => {
    state.row = conn({ token_expiry: new Date(Date.now() - 1000).toISOString() });
    fetchMock
      .mockResolvedValueOnce(res(200, { access_token: "at_new", refresh_token: "rt_2", expires_in: 3600 }))
      .mockResolvedValueOnce(res(201, { id: 1, join_url: "https://zoom.us/j/1" }));
    const { createZoomMeeting } = await import("../../lib/meetings");
    const m = await createZoomMeeting("st1", { topic: "t", startMs: Date.now(), durationMin: 15, bookingId: "b1" });
    expect(m?.joinUrl).toBe("https://zoom.us/j/1");
    const [tokUrl, tokOpts] = fetchMock.mock.calls[0];
    expect(tokUrl).toBe("https://zoom.us/oauth/token");
    expect(tokOpts.headers.Authorization).toBe("Basic " + Buffer.from("zid:zsecret").toString("base64"));
    expect(new URLSearchParams(tokOpts.body).get("grant_type")).toBe("refresh_token");
    // rotated refresh token was persisted
    expect(state.updates.some((u) => u.refresh_token_enc === "rt_2" && u.access_token_enc === "at_new")).toBe(true);
    // the meeting call used the fresh token
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer at_new");
  });

  it("returns null (no throw) when the staffer has no Zoom connection", async () => {
    state.row = null;
    const { createZoomMeeting } = await import("../../lib/meetings");
    expect(await createZoomMeeting("st1", { topic: "t", startMs: Date.now(), durationMin: 30, bookingId: "b1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null (no throw) when Zoom errors — booking must never fail on Zoom", async () => {
    fetchMock.mockResolvedValueOnce(res(429, { message: "rate limited" }));
    const { createZoomMeeting } = await import("../../lib/meetings");
    expect(await createZoomMeeting("st1", { topic: "t", startMs: Date.now(), durationMin: 30, bookingId: "b1" })).toBeNull();
  });

  it("returns null when ZOOM_* env is not configured", async () => {
    delete process.env.ZOOM_CLIENT_ID;
    const { createZoomMeeting } = await import("../../lib/meetings");
    expect(await createZoomMeeting("st1", { topic: "t", startMs: Date.now(), durationMin: 30, bookingId: "b1" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("updateZoomMeeting / deleteZoomMeeting", () => {
  it("PATCHes the meeting time on reschedule", async () => {
    fetchMock.mockResolvedValueOnce(res(204, {}));
    const { updateZoomMeeting } = await import("../../lib/meetings");
    await updateZoomMeeting("st1", "987", { startMs: Date.parse("2026-09-02T10:00:00Z"), durationMin: 45, tz: "America/New_York" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.zoom.us/v2/meetings/987");
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body).duration).toBe(45);
  });

  it("DELETEs the meeting on cancel and treats 404 as success", async () => {
    fetchMock.mockResolvedValueOnce(res(404, {}));
    const { deleteZoomMeeting } = await import("../../lib/meetings");
    await deleteZoomMeeting("st1", "987"); // must not throw
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.zoom.us/v2/meetings/987");
    expect(opts.method).toBe("DELETE");
  });
});
