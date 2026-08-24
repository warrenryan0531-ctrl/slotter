import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Per-tenant SMS resolution (credsFor) queries bh_tenant_sms via db() before sending. Stub db()
// so that lookup is deterministic and doesn't consume the mocked fetch — `state.row` controls
// whether the tenant has its own number (else it falls back to the deployment-wide TWILIO_* env).
const state = vi.hoisted(() => ({ row: [] as unknown[] }));
vi.mock("../../lib/db", () => {
  // Minimal chainable stub matching db().from(x).select(x).eq(x,y).eq(x,y).limit(n)
  const q: Record<string, unknown> = {};
  q.select = () => q; q.eq = () => q; q.limit = () => Promise.resolve({ data: state.row });
  return { db: () => ({ from: () => q }) };
});

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.row = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  Object.assign(process.env, {
    APP_MODE: "prod", SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "k",
    BH_API_KEY: "k", APP_SECRET: "s", RESEND_API_KEY: "re", MAIL_FROM: "b@x.com",
    TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "authtok", TWILIO_FROM: "+15550001111",
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("TwilioSms.send", () => {
  it("POSTs to the Twilio Messages endpoint with basic auth and the right body (deployment sender)", async () => {
    fetchMock.mockResolvedValueOnce(res(201, { sid: "SM1" }));
    const { getServices } = await import("../../lib/services");
    const { sms } = getServices();
    expect(sms.enabled).toBe(true);
    await sms.send({ tenantId: "t1", to: "+15559990000", body: "Your booking is confirmed" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Basic " + Buffer.from("ACtest:authtok").toString("base64"));
    const params = new URLSearchParams(opts.body);
    expect(params.get("To")).toBe("+15559990000");
    expect(params.get("From")).toBe("+15550001111");
    expect(params.get("Body")).toBe("Your booking is confirmed");
  });

  it("uses the tenant's OWN number when one is configured in bh_tenant_sms", async () => {
    state.row = [{ twilio_account_sid: "ACown", twilio_auth_token: "owntok", twilio_from: "+15557778888" }];
    fetchMock.mockResolvedValueOnce(res(201, { sid: "SM2" }));
    const { getServices } = await import("../../lib/services");
    await getServices().sms.send({ tenantId: "t9", to: "+15551112222", body: "hi" });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACown/Messages.json");
    expect(opts.headers.Authorization).toBe("Basic " + Buffer.from("ACown:owntok").toString("base64"));
    expect(new URLSearchParams(opts.body).get("From")).toBe("+15557778888");
  });

  it("throws on a Twilio error response", async () => {
    fetchMock.mockResolvedValueOnce(res(400, { message: "bad number" }));
    const { getServices } = await import("../../lib/services");
    await expect(getServices().sms.send({ tenantId: null, to: "x", body: "y" })).rejects.toThrow(/Twilio send failed: 400/);
  });
});
