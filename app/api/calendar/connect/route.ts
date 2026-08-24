import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { saveConnection } from "@/lib/calendar";
import { newToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Resolve the staff row to attach the calendar to: the signed-in owner's own staff record.
async function ownerStaffId(tenantId: string, email: string): Promise<string | null> {
  const { data } = await db().from("bh_staff").select("id, email, is_owner").eq("tenant_id", tenantId);
  const rows = (data as { id: string; email: string | null; is_owner: boolean }[]) ?? [];
  return rows.find((s) => s.email?.toLowerCase() === email.toLowerCase())?.id
    ?? rows.find((s) => s.is_owner)?.id ?? null;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider");
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? url.origin;
  const back = `${base}/dashboard/availability`;

  const staffId = await ownerStaffId(session.tenantId, session.email);
  if (!staffId) return NextResponse.redirect(`${back}?calendar=error`);

  // Demo: connect a fake calendar instantly so the whole two-way behavior is visible with no OAuth.
  if (provider === "demo") {
    await saveConnection({ staffId, provider: "demo", accountEmail: "demo-calendar@slotter.local" });
    return NextResponse.redirect(`${back}?calendar=connected`);
  }

  // Signed-ish CSRF: store staffId + nonce in a short-lived httpOnly cookie, echo nonce in state.
  const nonce = newToken();
  const state = Buffer.from(JSON.stringify({ staffId, nonce })).toString("base64url");
  (await cookies()).set("cal_oauth", JSON.stringify({ nonce, staffId }), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });
  const redirectUri = `${base}/api/calendar/callback`;

  if (provider === "google") {
    const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!id) return NextResponse.redirect(`${back}?calendar=unconfigured`);
    const p = new URLSearchParams({
      client_id: id, redirect_uri: `${redirectUri}?provider=google`, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
    });
    return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  }

  if (provider === "microsoft") {
    const id = process.env.MS_OAUTH_CLIENT_ID;
    const tenant = process.env.MS_OAUTH_TENANT || "common";
    if (!id) return NextResponse.redirect(`${back}?calendar=unconfigured`);
    const p = new URLSearchParams({
      client_id: id, redirect_uri: `${redirectUri}?provider=microsoft`, response_type: "code",
      scope: "offline_access Calendars.ReadWrite User.Read", response_mode: "query", state,
    });
    return NextResponse.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${p}`);
  }

  return NextResponse.redirect(`${back}?calendar=error`);
}
