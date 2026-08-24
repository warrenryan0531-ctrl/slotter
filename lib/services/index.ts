import { envConfig } from "../env";
import { db } from "../db";
import { paymentPort, type PaymentPort } from "./payments";

export type MailMsg = {
  tenantId: string | null;
  to: string;
  subject: string;
  html: string;
  ics?: { text: string; method: "REQUEST" | "CANCEL" } | null;
  bcc?: boolean;  // BCC the configured ops inbox (OWNER_NOTICE_BCC), if any
  fromName?: string;
  replyTo?: string;
};

export interface MailPort { send(msg: MailMsg): Promise<void>; }

class DemoMail implements MailPort {
  async send(msg: MailMsg): Promise<void> {
    const { error } = await db().from("bh_outbox_emails").insert({
      tenant_id: msg.tenantId, to_addr: msg.to, subject: msg.subject,
      html: msg.html, ics_text: msg.ics?.text ?? null, channel: "email",
    });
    if (error) throw new Error(`outbox insert failed: ${error.message}`);
  }
}

class ResendMail implements MailPort {
  constructor(private apiKey: string, private from: string, private bcc: string | null) {}
  async send(msg: MailMsg): Promise<void> {
    const body: Record<string, unknown> = {
      from: `${msg.fromName ?? "Bookings"} <${this.from}>`,
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
    };
    if (msg.replyTo) body.reply_to = msg.replyTo;
    if (msg.bcc && this.bcc) body.bcc = [this.bcc];
    if (msg.ics) {
      body.attachments = [{ filename: "invite.ics", content: Buffer.from(msg.ics.text).toString("base64"), content_type: `text/calendar; method=${msg.ics.method}` }];
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Resend send failed: ${res.status} ${await res.text()}`);
  }
}

// ---- SMS ----
export type SmsMsg = { tenantId: string | null; to: string; body: string };
export interface SmsPort { enabled: boolean; send(msg: SmsMsg): Promise<void>; }

class DemoSms implements SmsPort {
  enabled = true;
  async send(msg: SmsMsg): Promise<void> {
    // Demo: land it in the same outbox as email so it's visible at /demo/outbox.
    await db().from("bh_outbox_emails").insert({
      tenant_id: msg.tenantId, to_addr: msg.to, subject: "SMS", html: msg.body, channel: "sms",
    });
  }
}

type TwilioCreds = { sid: string; token: string; from: string };

class TwilioSms implements SmsPort {
  enabled = true;
  // `fallback` is the deployment-wide sender from the TWILIO_* env vars (may be null if only
  // per-tenant senders are configured). Per-tenant creds in bh_tenant_sms override it at send time.
  constructor(private fallback: TwilioCreds | null) {}

  private async credsFor(tenantId: string | null): Promise<TwilioCreds | null> {
    if (tenantId) {
      const { data } = await db().from("bh_tenant_sms")
        .select("twilio_account_sid, twilio_auth_token, twilio_from")
        .eq("tenant_id", tenantId).eq("active", true).limit(1);
      const c = data?.[0] as { twilio_account_sid?: string; twilio_auth_token?: string; twilio_from?: string } | undefined;
      if (c?.twilio_account_sid && c?.twilio_auth_token && c?.twilio_from) {
        return { sid: c.twilio_account_sid, token: c.twilio_auth_token, from: c.twilio_from }; // this business's own number
      }
    }
    return this.fallback; // deployment-wide number, if configured
  }

  async send(msg: SmsMsg): Promise<void> {
    const creds = await this.credsFor(msg.tenantId);
    if (!creds) { console.warn(`[sms] no Twilio sender configured for tenant ${msg.tenantId} — skipped`); return; }
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${creds.sid}:${creds.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: msg.to, From: creds.from, Body: msg.body }),
    });
    if (!res.ok) throw new Error(`Twilio send failed: ${res.status} ${await res.text()}`);
  }
}

export type Services = { mail: MailPort; sms: SmsPort; pay: PaymentPort; mode: "demo" | "prod" };

/**
 * Can THIS tenant actually send a text right now? Used to decide whether to show the SMS opt-in on
 * the booking page (never collect consent we can't honor). True when: demo mode (simulated), OR a
 * deployment-wide TWILIO_* number is set, OR this tenant has its own active number in bh_tenant_sms.
 */
export async function smsAvailableForTenant(tenantId: string): Promise<boolean> {
  const cfg = envConfig();
  if (cfg.mode === "demo") return true;
  if (cfg.twilio) return true;
  const { data } = await db().from("bh_tenant_sms")
    .select("twilio_auth_token").eq("tenant_id", tenantId).eq("active", true).limit(1);
  return !!(data?.[0] as { twilio_auth_token?: string } | undefined)?.twilio_auth_token;
}

let _services: Services | null = null;

export function getServices(): Services {
  if (_services) return _services;
  const cfg = envConfig(); // throws loudly in prod when config is missing
  if (cfg.mode === "prod") {
    _services = {
      mail: new ResendMail(cfg.resendApiKey!, cfg.mailFrom, cfg.bccOwnerNotices),
      // Always the Twilio adapter in prod so per-tenant senders work even without a global number;
      // it resolves each tenant's own number (or the global fallback) at send time.
      sms: new TwilioSms(cfg.twilio ? { sid: cfg.twilio.sid, token: cfg.twilio.token, from: cfg.twilio.from } : null),
      pay: paymentPort("prod"), mode: "prod",
    };
  } else {
    _services = { mail: new DemoMail(), sms: new DemoSms(), pay: paymentPort("demo"), mode: "demo" };
  }
  return _services;
}
