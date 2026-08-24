export type AppMode = "demo" | "prod";

export function appMode(): AppMode {
  const m = process.env.APP_MODE ?? "demo";
  if (m !== "demo" && m !== "prod") throw new Error(`Invalid APP_MODE: ${m}`);
  return m;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name} (APP_MODE=${appMode()})`);
  return v;
}

export function envConfig() {
  const mode = appMode();
  const base = {
    mode,
    supabaseUrl: required("SUPABASE_URL"),
    supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    bhApiKey: required("BH_API_KEY"), // minted app secret enforced by RLS + rpc guards (see architecture deviation note)
    appSecret: required("APP_SECRET"),
    baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000",
    // Comma-separated emails allowed into the /admin console. No default — set ADMIN_EMAILS.
    adminEmails: (process.env.ADMIN_EMAILS ?? "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Optional: BCC every owner notification to an ops inbox (e.g. an agency running many tenants).
    ownerNoticeBcc: process.env.OWNER_NOTICE_BCC || null,
  };
  // SMS (optional in prod — SMS simply stays off if unconfigured; demo always uses the outbox).
  const twilio = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM)
    ? { sid: process.env.TWILIO_ACCOUNT_SID, token: process.env.TWILIO_AUTH_TOKEN, from: process.env.TWILIO_FROM }
    : null;
  if (mode === "prod") {
    // Never silently downgrade: prod without prod config must throw at startup.
    return { ...base, resendApiKey: required("RESEND_API_KEY"), mailFrom: required("MAIL_FROM"), bccOwnerNotices: base.ownerNoticeBcc, twilio };
  }
  return { ...base, resendApiKey: null, mailFrom: "bookings@demo.slotter.local", bccOwnerNotices: base.ownerNoticeBcc, twilio };
}
