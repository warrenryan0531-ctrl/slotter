// Calendar-sync orchestration (E1). Bridges stored connections ↔ adapters, handles token
// decrypt/refresh, freebusy caching + fail-safe (R5), and best-effort booking push (R3).
import { db } from "./db";
import { encryptSecret, decryptSecret } from "./crypto";
import { calendarAdapter, type CalConnection, type Interval, type PushEvent } from "./services/calendar";
import { isoDate, dateInTz } from "./engine/tz";

type Row = {
  id: string; staff_id: string; provider: "google" | "microsoft" | "demo";
  external_calendar_id: string | null; account_email: string | null;
  access_token_enc: string | null; refresh_token_enc: string | null; token_expiry: string | null;
  block_busy: boolean; sync_events: boolean;
};

function toConn(r: Row): CalConnection {
  return {
    id: r.id, provider: r.provider, externalCalendarId: r.external_calendar_id,
    accessToken: decryptSecret(r.access_token_enc), refreshToken: decryptSecret(r.refresh_token_enc),
    tokenExpiry: r.token_expiry,
  };
}

async function rowsForStaff(staffId: string): Promise<Row[]> {
  const { data } = await db().from("bh_calendar_connections").select("*").eq("staff_id", staffId);
  return (data as Row[]) ?? [];
}

/** Persist connection token material after a refresh (re-encrypting). */
async function persistRefreshed(connId: string, accessToken: string, tokenExpiry: string, refreshToken?: string | null) {
  const patch: Record<string, unknown> = { access_token_enc: encryptSecret(accessToken), token_expiry: tokenExpiry, updated_at: new Date().toISOString() };
  if (refreshToken) patch.refresh_token_enc = encryptSecret(refreshToken);
  await db().from("bh_calendar_connections").update(patch).eq("id", connId);
}

const CACHE_TTL_MS = 60000;

/**
 * External busy intervals for a staff member across [fromMs,toMs).
 * Per-connection: refresh token if needed, read events (self-filtered), union.
 * R5 fail-safe: on provider error, fall back to the last cached busy set (never empty-out
 * the owner's real commitments). Throttled by a 60s durable cache per staff per day.
 */
export async function externalBusyForStaff(tz: string, staffId: string, now: number, fromMs: number, toMs: number): Promise<Interval[]> {
  const rows = (await rowsForStaff(staffId)).filter((r) => r.block_busy);
  if (!rows.length) return [];

  const cacheDay = isoDate(dateInTz(now, tz));
  const { data: cacheRows } = await db().from("bh_freebusy_cache").select("*").eq("staff_id", staffId).eq("day", cacheDay).limit(1);
  const cached = cacheRows?.[0] as { busy: Interval[]; fetched_at: string } | undefined;
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_TTL_MS) {
    return cached.busy ?? [];
  }

  const merged: Interval[] = [];
  let hadError = false;
  for (const r of rows) {
    const conn = toConn(r);
    const adapter = calendarAdapter(r.provider);
    try {
      const refreshed = await adapter.ensureFreshToken(conn);
      if (refreshed) await persistRefreshed(r.id, refreshed.accessToken, refreshed.tokenExpiry, conn.refreshToken);
      const busy = await adapter.busy(conn, fromMs, toMs);
      merged.push(...busy);
    } catch (e) {
      hadError = true;
      console.error(`[calendar] busy failed for connection ${r.id} (${r.provider}):`, (e as Error).message);
    }
  }

  if (hadError && cached) {
    // R5: don't drop real busy time on a transient provider error — reuse last good set.
    return cached.busy ?? [];
  }
  await db().from("bh_freebusy_cache").upsert({ staff_id: staffId, day: cacheDay, busy: merged, fetched_at: new Date().toISOString() });
  return merged;
}

/**
 * Push a booking to every connected calendar that has sync_events on (best-effort, R3).
 * action 'upsert' creates/updates + records the external event id per connection;
 * action 'delete' removes it. Never throws — failures are logged and recorded, and the
 * caller's core DB transaction is unaffected.
 */
export async function syncBookingToCalendars(
  staffId: string,
  bookingId: string,
  action: "upsert" | "delete",
  ev?: PushEvent,
): Promise<void> {
  try {
    const rows = (await rowsForStaff(staffId)).filter((r) => r.sync_events);
    if (!rows.length) return;
    const { data: bk } = await db().from("bh_bookings").select("external_event_ref").eq("id", bookingId).limit(1);
    const refs: Record<string, string> = (bk?.[0]?.external_event_ref as Record<string, string>) ?? {};

    for (const r of rows) {
      const conn = toConn(r);
      const adapter = calendarAdapter(r.provider);
      try {
        const refreshed = await adapter.ensureFreshToken(conn);
        if (refreshed) await persistRefreshed(r.id, refreshed.accessToken, refreshed.tokenExpiry, conn.refreshToken);
        if (action === "delete") {
          if (refs[r.id]) { await adapter.deleteEvent(conn, refs[r.id]); delete refs[r.id]; }
        } else if (ev) {
          const extId = await adapter.upsertEvent(conn, ev, refs[r.id] ?? null);
          if (extId) refs[r.id] = extId;
        }
      } catch (e) {
        console.error(`[calendar] ${action} failed for connection ${r.id}:`, (e as Error).message);
      }
    }
    await db().from("bh_bookings").update({ external_event_ref: refs }).eq("id", bookingId);
  } catch (e) {
    console.error(`[calendar] syncBookingToCalendars outer error:`, (e as Error).message);
  }
}

/** Save a new connection (tokens encrypted at rest). Used by the OAuth callback + demo connect. */
export async function saveConnection(input: {
  staffId: string; provider: "google" | "microsoft" | "demo";
  externalCalendarId?: string | null; accountEmail?: string | null;
  accessToken?: string | null; refreshToken?: string | null; tokenExpiry?: string | null;
}): Promise<void> {
  await db().from("bh_calendar_connections").insert({
    staff_id: input.staffId,
    provider: input.provider,
    external_calendar_id: input.externalCalendarId ?? (input.provider === "google" ? "primary" : null),
    account_email: input.accountEmail ?? null,
    access_token_enc: encryptSecret(input.accessToken),
    refresh_token_enc: encryptSecret(input.refreshToken),
    token_expiry: input.tokenExpiry ?? null,
  });
}

export async function listConnections(staffId: string): Promise<{ id: string; provider: string; account_email: string | null }[]> {
  const { data } = await db().from("bh_calendar_connections").select("id, provider, account_email").eq("staff_id", staffId);
  return (data as { id: string; provider: string; account_email: string | null }[]) ?? [];
}

/**
 * Does this staff member have a connected calendar that receives booking write-backs
 * (sync_events = true)? When true, the app already pushes each booking onto the owner's
 * calendar via the provider API — so the owner must NOT also be listed as an .ics attendee,
 * or their calendar client auto-adds a SECOND (duplicate) copy of the same event.
 */
export async function ownerCalendarSyncs(staffId: string): Promise<boolean> {
  const { data } = await db().from("bh_calendar_connections")
    .select("id").eq("staff_id", staffId).eq("sync_events", true).limit(1);
  return ((data as unknown[]) ?? []).length > 0;
}

export async function removeConnection(id: string): Promise<void> {
  await db().from("bh_calendar_connections").delete().eq("id", id);
}

/** Pure: does a cancelled/declined booking still hold external event refs to clean up? (H4) */
export function needsReconcile(status: string, externalEventRef: Record<string, unknown> | null): boolean {
  return (status === "cancelled" || status === "declined") && !!externalEventRef && Object.keys(externalEventRef).length > 0;
}

/**
 * Reconciliation sweep (H4 / R3 durability): find cancelled/declined bookings whose external
 * calendar event was never removed (a failed delete left a ghost) and delete it now. Reuses the
 * same delete path, which clears the ref on success. Bounded per run; safe to run every cron tick.
 */
export async function reconcileOrphanedCalendarEvents(limit = 100): Promise<number> {
  const { data } = await db().from("bh_bookings")
    .select("id, staff_id, status, external_event_ref")
    .in("status", ["cancelled", "declined"])
    .order("created_at", { ascending: false })
    .limit(500);
  const orphans = ((data as { id: string; staff_id: string; status: string; external_event_ref: Record<string, unknown> }[]) ?? [])
    .filter((b) => needsReconcile(b.status, b.external_event_ref))
    .slice(0, limit);
  let cleaned = 0;
  for (const b of orphans) {
    await syncBookingToCalendars(b.staff_id, b.id, "delete");
    cleaned++;
  }
  return cleaned;
}
