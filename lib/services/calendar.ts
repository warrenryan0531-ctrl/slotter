// CalendarPort + adapters (E1). Two-way sync: read external busy to block slots,
// push/patch/delete our bookings on the owner's real calendar.
//
// R3 (self-collision): busy() reads events and filters out Slotter-authored ones by a
// marker, so our own pushed events — even a ghost left by a failed delete — never block
// the very slots we've booked or freed. bh_bookings remains the source of truth for our holds.
export type Interval = { start: number; end: number }; // UTC ms

export type CalConnection = {
  id: string;
  provider: "google" | "microsoft" | "demo";
  externalCalendarId: string | null;
  accessToken: string | null;   // decrypted by the caller
  refreshToken: string | null;  // decrypted by the caller
  tokenExpiry: string | null;
};

export type PushEvent = {
  bookingId: string;
  title: string;
  description?: string;
  location?: string;
  start: number; // UTC ms
  end: number;
};

/** Fresh token material to persist (re-encrypted by the caller), or null if unchanged. */
export type RefreshedToken = { accessToken: string; tokenExpiry: string } | null;

export interface CalendarAdapter {
  /** External busy intervals in [fromMs,toMs), EXCLUDING Slotter-authored events (R3). */
  busy(conn: CalConnection, fromMs: number, toMs: number): Promise<Interval[]>;
  /** Create or update the calendar event for this booking; returns the external event id. */
  upsertEvent(conn: CalConnection, ev: PushEvent, existingId?: string | null): Promise<string | null>;
  /** Remove the event (best-effort; may 404 if already gone). */
  deleteEvent(conn: CalConnection, externalId: string): Promise<void>;
  /** Refresh the access token if near expiry; returns new material to persist or null. */
  ensureFreshToken(conn: CalConnection): Promise<RefreshedToken>;
}

const MARKER = "slotterBookingId";
const iso = (ms: number) => new Date(ms).toISOString();

// ---------------- Demo ----------------
// Fully functional with zero external services: blocks 15:00–16:00 UTC each day (≈ late
// morning US-Eastern, inside typical business hours) so a slot visibly disappears, and
// treats pushes as no-ops (recording is done by the orchestration layer).
class DemoCalendar implements CalendarAdapter {
  async busy(_conn: CalConnection, fromMs: number, toMs: number): Promise<Interval[]> {
    const out: Interval[] = [];
    const DAY = 86400000;
    const dayStart = Math.floor(fromMs / DAY) * DAY;
    for (let t = dayStart; t < toMs; t += DAY) {
      const start = t + 15 * 3600000;
      const end = t + 16 * 3600000;
      if (end > fromMs && start < toMs) out.push({ start, end });
    }
    return out;
  }
  async upsertEvent(_c: CalConnection, ev: PushEvent, existingId?: string | null): Promise<string | null> {
    return existingId ?? `demo-evt-${ev.bookingId}`;
  }
  async deleteEvent(): Promise<void> { /* no-op */ }
  async ensureFreshToken(): Promise<RefreshedToken> { return null; }
}

// ---------------- Google Calendar ----------------
class GoogleCalendar implements CalendarAdapter {
  private base = "https://www.googleapis.com/calendar/v3";
  private cal(conn: CalConnection) { return encodeURIComponent(conn.externalCalendarId || "primary"); }

  async ensureFreshToken(conn: CalConnection): Promise<RefreshedToken> {
    const skewMs = 60000;
    if (conn.tokenExpiry && Date.parse(conn.tokenExpiry) - skewMs > Date.now()) return null;
    if (!conn.refreshToken) return null;
    const id = process.env.GOOGLE_OAUTH_CLIENT_ID, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!id || !secret) throw new Error("GOOGLE_OAUTH_CLIENT_ID/SECRET not configured");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: conn.refreshToken, grant_type: "refresh_token" }),
    });
    if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
    const j = await res.json();
    conn.accessToken = j.access_token; // mutate for immediate use
    const expiry = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
    conn.tokenExpiry = expiry;
    return { accessToken: j.access_token, tokenExpiry: expiry };
  }

  private auth(conn: CalConnection) { return { Authorization: `Bearer ${conn.accessToken}` }; }

  async busy(conn: CalConnection, fromMs: number, toMs: number): Promise<Interval[]> {
    const params = new URLSearchParams({
      timeMin: iso(fromMs), timeMax: iso(toMs), singleEvents: "true", showDeleted: "false", maxResults: "250",
    });
    const res = await fetch(`${this.base}/calendars/${this.cal(conn)}/events?${params}`, { headers: this.auth(conn) });
    if (!res.ok) throw new Error(`google events.list failed: ${res.status}`);
    const j = await res.json();
    const out: Interval[] = [];
    for (const e of j.items ?? []) {
      if (e.status === "cancelled") continue;
      if (e.transparency === "transparent") continue;           // "free" events don't block
      if (e.extendedProperties?.private?.[MARKER]) continue;     // R3: skip our own events
      const s = e.start?.dateTime ?? e.start?.date;
      const en = e.end?.dateTime ?? e.end?.date;
      if (!s || !en) continue;
      out.push({ start: Date.parse(s), end: Date.parse(en) });
    }
    return out;
  }

  async upsertEvent(conn: CalConnection, ev: PushEvent, existingId?: string | null): Promise<string | null> {
    const body = {
      summary: ev.title,
      description: ev.description,
      location: ev.location,
      start: { dateTime: iso(ev.start) },
      end: { dateTime: iso(ev.end) },
      extendedProperties: { private: { [MARKER]: ev.bookingId } },
    };
    const url = existingId
      ? `${this.base}/calendars/${this.cal(conn)}/events/${encodeURIComponent(existingId)}`
      : `${this.base}/calendars/${this.cal(conn)}/events`;
    const res = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { ...this.auth(conn), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`google events.${existingId ? "patch" : "insert"} failed: ${res.status}`);
    return (await res.json()).id ?? null;
  }

  async deleteEvent(conn: CalConnection, externalId: string): Promise<void> {
    const res = await fetch(`${this.base}/calendars/${this.cal(conn)}/events/${encodeURIComponent(externalId)}`, {
      method: "DELETE", headers: this.auth(conn),
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`google events.delete failed: ${res.status}`);
  }
}

// ---------------- Microsoft Graph (Outlook / 365) ----------------
class MicrosoftCalendar implements CalendarAdapter {
  private base = "https://graph.microsoft.com/v1.0";
  // Named extended property for our marker (survives round-trips through Graph).
  private extProp = `String {a1b2c3d4-0000-0000-0000-slotter00000} Name ${MARKER}`;

  async ensureFreshToken(conn: CalConnection): Promise<RefreshedToken> {
    const skewMs = 60000;
    if (conn.tokenExpiry && Date.parse(conn.tokenExpiry) - skewMs > Date.now()) return null;
    if (!conn.refreshToken) return null;
    const id = process.env.MS_OAUTH_CLIENT_ID, secret = process.env.MS_OAUTH_CLIENT_SECRET;
    const tenant = process.env.MS_OAUTH_TENANT || "common";
    if (!id || !secret) throw new Error("MS_OAUTH_CLIENT_ID/SECRET not configured");
    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id, client_secret: secret, refresh_token: conn.refreshToken,
        grant_type: "refresh_token", scope: "offline_access Calendars.ReadWrite",
      }),
    });
    if (!res.ok) throw new Error(`microsoft token refresh failed: ${res.status}`);
    const j = await res.json();
    conn.accessToken = j.access_token;
    if (j.refresh_token) conn.refreshToken = j.refresh_token;
    const expiry = new Date(Date.now() + (j.expires_in ?? 3600) * 1000).toISOString();
    conn.tokenExpiry = expiry;
    return { accessToken: j.access_token, tokenExpiry: expiry };
  }

  private auth(conn: CalConnection) { return { Authorization: `Bearer ${conn.accessToken}` }; }

  async busy(conn: CalConnection, fromMs: number, toMs: number): Promise<Interval[]> {
    const params = new URLSearchParams({ startDateTime: iso(fromMs), endDateTime: iso(toMs), "$top": "250" });
    const res = await fetch(`${this.base}/me/calendarView?${params}&$expand=singleValueExtendedProperties($filter=id eq '${encodeURIComponent(this.extProp)}')`, {
      headers: { ...this.auth(conn), Prefer: 'outlook.timezone="UTC"' },
    });
    if (!res.ok) throw new Error(`graph calendarView failed: ${res.status}`);
    const j = await res.json();
    const out: Interval[] = [];
    for (const e of j.value ?? []) {
      if (e.isCancelled) continue;
      if (e.showAs === "free") continue;
      const mine = (e.singleValueExtendedProperties ?? []).some((p: { value?: string }) => p.value);
      if (mine) continue; // R3: skip our own events
      const s = e.start?.dateTime, en = e.end?.dateTime;
      if (!s || !en) continue;
      // Graph returns naive UTC when Prefer timezone=UTC; ensure Z.
      out.push({ start: Date.parse(s.endsWith("Z") ? s : s + "Z"), end: Date.parse(en.endsWith("Z") ? en : en + "Z") });
    }
    return out;
  }

  async upsertEvent(conn: CalConnection, ev: PushEvent, existingId?: string | null): Promise<string | null> {
    const body = {
      subject: ev.title,
      body: { contentType: "text", content: ev.description ?? "" },
      location: ev.location ? { displayName: ev.location } : undefined,
      start: { dateTime: iso(ev.start), timeZone: "UTC" },
      end: { dateTime: iso(ev.end), timeZone: "UTC" },
      singleValueExtendedProperties: [{ id: this.extProp, value: ev.bookingId }],
    };
    const url = existingId ? `${this.base}/me/events/${encodeURIComponent(existingId)}` : `${this.base}/me/events`;
    const res = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { ...this.auth(conn), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`graph event ${existingId ? "patch" : "create"} failed: ${res.status}`);
    return (await res.json()).id ?? null;
  }

  async deleteEvent(conn: CalConnection, externalId: string): Promise<void> {
    const res = await fetch(`${this.base}/me/events/${encodeURIComponent(externalId)}`, { method: "DELETE", headers: this.auth(conn) });
    if (!res.ok && res.status !== 404) throw new Error(`graph event delete failed: ${res.status}`);
  }
}

const demo = new DemoCalendar();
const google = new GoogleCalendar();
const microsoft = new MicrosoftCalendar();

export function calendarAdapter(provider: "google" | "microsoft" | "demo"): CalendarAdapter {
  if (provider === "google") return google;
  if (provider === "microsoft") return microsoft;
  return demo;
}
