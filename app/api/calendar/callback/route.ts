import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { saveConnection } from "@/lib/calendar";

export const dynamic = "force-dynamic";

// OAuth callback for Google / Microsoft. Exchanges the code for tokens and stores an
// (encrypted) connection. Tokens never touch the client — this all runs server-side.
export async function GET(req: Request) {
  const session = await getSession();
  const url = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? url.origin;
  const back = `${base}/dashboard/availability`;
  if (!session?.tenantId) return NextResponse.redirect(`${base}/dashboard`);

  const provider = url.searchParams.get("provider");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !provider) return NextResponse.redirect(`${back}?calendar=error`);

  // CSRF: match the nonce we stashed at connect time.
  const jar = await cookies();
  const raw = jar.get("cal_oauth")?.value;
  jar.delete("cal_oauth");
  if (!raw || !state) return NextResponse.redirect(`${back}?calendar=error`);
  let staffId: string, nonce: string;
  try { const c = JSON.parse(raw); staffId = c.staffId; nonce = c.nonce; } catch { return NextResponse.redirect(`${back}?calendar=error`); }
  try { const s = JSON.parse(Buffer.from(state, "base64url").toString()); if (s.nonce !== nonce) throw new Error("nonce mismatch"); } catch { return NextResponse.redirect(`${back}?calendar=error`); }

  const redirectUri = `${base}/api/calendar/callback?provider=${provider}`;

  try {
    if (provider === "google") {
      const id = process.env.GOOGLE_OAUTH_CLIENT_ID!, secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET!;
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      });
      if (!res.ok) throw new Error(`token exchange ${res.status}`);
      const t = await res.json();
      let email: string | null = null;
      try {
        const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } });
        if (me.ok) email = (await me.json()).email ?? null;
      } catch { /* email is best-effort */ }
      await saveConnection({
        staffId, provider: "google", externalCalendarId: "primary", accountEmail: email,
        accessToken: t.access_token, refreshToken: t.refresh_token,
        tokenExpiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      });
    } else if (provider === "microsoft") {
      const id = process.env.MS_OAUTH_CLIENT_ID!, secret = process.env.MS_OAUTH_CLIENT_SECRET!;
      const tenant = process.env.MS_OAUTH_TENANT || "common";
      const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri, grant_type: "authorization_code", scope: "offline_access Calendars.ReadWrite User.Read" }),
      });
      if (!res.ok) throw new Error(`token exchange ${res.status}`);
      const t = await res.json();
      let email: string | null = null;
      try {
        const me = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${t.access_token}` } });
        if (me.ok) { const j = await me.json(); email = j.mail ?? j.userPrincipalName ?? null; }
      } catch { /* best-effort */ }
      await saveConnection({
        staffId, provider: "microsoft", accountEmail: email,
        accessToken: t.access_token, refreshToken: t.refresh_token,
        tokenExpiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
      });
    } else {
      return NextResponse.redirect(`${back}?calendar=error`);
    }
  } catch (e) {
    console.error("[calendar] callback failed:", (e as Error).message);
    return NextResponse.redirect(`${back}?calendar=error`);
  }
  return NextResponse.redirect(`${back}?calendar=connected`);
}
