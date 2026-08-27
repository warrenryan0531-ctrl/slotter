// B1 Layer B — Zoom meeting integration. Mirrors lib/calendar.ts: per-staff OAuth connections with
// AES-256-GCM-encrypted tokens, server-side refresh, best-effort create/delete that never blocks a
// booking. A video-service booking PREFERS a connected Zoom account; without one it falls back to
// the calendar-minted Google Meet / Teams link (Layer A) — same contract, different provider.
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";

const ZOOM_TOKEN_URL = "https://zoom.us/oauth/token";
const ZOOM_API = "https://api.zoom.us/v2";

export function zoomConfigured(): boolean {
  return Boolean(process.env.ZOOM_CLIENT_ID && process.env.ZOOM_CLIENT_SECRET);
}

function basicAuth(): string {
  return "Basic " + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
}

type ConnRow = {
  id: string; staff_id: string; provider: string; account_email: string | null;
  access_token_enc: string | null; refresh_token_enc: string | null; token_expiry: string | null; active: boolean;
};

async function activeZoomRow(staffId: string): Promise<ConnRow | null> {
  const { data } = await db().from("bh_meeting_connections").select("*")
    .eq("staff_id", staffId).eq("provider", "zoom").eq("active", true).limit(1);
  return ((data as ConnRow[]) ?? [])[0] ?? null;
}

/** Refresh the access token when it's expired/near expiry; persist re-encrypted material. */
async function freshAccessToken(row: ConnRow): Promise<string | null> {
  const access = decryptSecret(row.access_token_enc);
  const refresh = decryptSecret(row.refresh_token_enc);
  const expMs = row.token_expiry ? Date.parse(row.token_expiry) : 0;
  if (access && expMs > Date.now() + 60_000) return access;
  if (!refresh) return access; // no refresh token — use what we have and hope
  const res = await fetch(ZOOM_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (!res.ok) throw new Error(`zoom token refresh failed: ${res.status}`);
  const t = await res.json();
  await db().from("bh_meeting_connections").update({
    access_token_enc: encryptSecret(t.access_token),
    // Zoom rotates refresh tokens on every refresh — always persist the new one.
    refresh_token_enc: encryptSecret(t.refresh_token ?? refresh),
    token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  return t.access_token as string;
}

/** Save a new Zoom connection (tokens encrypted at rest). One active connection per staffer. */
export async function saveZoomConnection(input: {
  staffId: string; accountEmail?: string | null;
  accessToken: string; refreshToken?: string | null; tokenExpiry?: string | null;
}): Promise<void> {
  // Replace any prior connection — reconnecting should never leave stale rows behind.
  await db().from("bh_meeting_connections").delete().eq("staff_id", input.staffId).eq("provider", "zoom");
  await db().from("bh_meeting_connections").insert({
    staff_id: input.staffId, provider: "zoom",
    account_email: input.accountEmail ?? null,
    access_token_enc: encryptSecret(input.accessToken),
    refresh_token_enc: encryptSecret(input.refreshToken),
    token_expiry: input.tokenExpiry ?? null,
  });
}

export async function listZoomConnections(staffId: string): Promise<{ id: string; account_email: string | null }[]> {
  const { data } = await db().from("bh_meeting_connections").select("id, account_email")
    .eq("staff_id", staffId).eq("provider", "zoom").eq("active", true);
  return (data as { id: string; account_email: string | null }[]) ?? [];
}

export async function removeZoomConnection(connId: string, staffId: string): Promise<void> {
  await db().from("bh_meeting_connections").delete().eq("id", connId).eq("staff_id", staffId);
}

/**
 * Create a Zoom meeting for a booking on the staffer's connected account.
 * Returns null when there's no active connection (caller falls back to Layer A).
 * Never throws on Zoom errors — a failed meeting create must not block the booking.
 */
export async function createZoomMeeting(staffId: string, args: {
  topic: string; startMs: number; durationMin: number; bookingId: string; tz?: string;
}): Promise<{ joinUrl: string; meetingId: string } | null> {
  try {
    if (!zoomConfigured()) return null;
    const row = await activeZoomRow(staffId);
    if (!row) return null;
    const token = await freshAccessToken(row);
    if (!token) return null;
    const res = await fetch(`${ZOOM_API}/users/me/meetings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: args.topic.slice(0, 200),
        type: 2, // scheduled
        start_time: new Date(args.startMs).toISOString(),
        duration: Math.max(1, Math.round(args.durationMin)),
        timezone: args.tz ?? "UTC",
        settings: { join_before_host: true, waiting_room: false },
      }),
    });
    if (!res.ok) throw new Error(`zoom create meeting: ${res.status}`);
    const m = await res.json();
    if (!m.join_url || !m.id) throw new Error("zoom create meeting: missing join_url/id");
    return { joinUrl: m.join_url as string, meetingId: String(m.id) };
  } catch (e) {
    console.error("[zoom] create meeting failed:", (e as Error).message);
    return null;
  }
}

/** Best-effort retime on reschedule — keeps the same join link. */
export async function updateZoomMeeting(staffId: string, meetingId: string, args: { startMs: number; durationMin: number; tz?: string }): Promise<void> {
  try {
    if (!zoomConfigured() || !meetingId) return;
    const row = await activeZoomRow(staffId);
    if (!row) return;
    const token = await freshAccessToken(row);
    if (!token) return;
    const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        start_time: new Date(args.startMs).toISOString(),
        duration: Math.max(1, Math.round(args.durationMin)),
        timezone: args.tz ?? "UTC",
      }),
    });
    if (!res.ok && res.status !== 404) throw new Error(`zoom update meeting: ${res.status}`);
  } catch (e) {
    console.error("[zoom] update meeting failed:", (e as Error).message);
  }
}

/** Best-effort delete on cancellation. Missing meeting (already deleted) is success. */
export async function deleteZoomMeeting(staffId: string, meetingId: string): Promise<void> {
  try {
    if (!zoomConfigured() || !meetingId) return;
    const row = await activeZoomRow(staffId);
    if (!row) return;
    const token = await freshAccessToken(row);
    if (!token) return;
    const res = await fetch(`${ZOOM_API}/meetings/${encodeURIComponent(meetingId)}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`zoom delete meeting: ${res.status}`);
  } catch (e) {
    console.error("[zoom] delete meeting failed:", (e as Error).message);
  }
}
