import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { saveZoomConnection } from "@/lib/meetings";

export const dynamic = "force-dynamic";

// Zoom OAuth callback. Exchanges the code for tokens and stores an encrypted connection.
// Tokens never touch the client — this all runs server-side (mirrors /api/calendar/callback).
export async function GET(req: Request) {
  const session = await getSession();
  const url = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? url.origin;
  const back = `${base}/dashboard/availability`;
  if (!session?.tenantId) return NextResponse.redirect(`${base}/dashboard`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code) return NextResponse.redirect(`${back}?zoom=error`);

  // CSRF: match the nonce stashed at connect time.
  const jar = await cookies();
  const raw = jar.get("zoom_oauth")?.value;
  jar.delete("zoom_oauth");
  if (!raw || !state) return NextResponse.redirect(`${back}?zoom=error`);
  let staffId: string, nonce: string;
  try { const c = JSON.parse(raw); staffId = c.staffId; nonce = c.nonce; } catch { return NextResponse.redirect(`${back}?zoom=error`); }
  try { const s = JSON.parse(Buffer.from(state, "base64url").toString()); if (s.nonce !== nonce) throw new Error("nonce mismatch"); } catch { return NextResponse.redirect(`${back}?zoom=error`); }

  try {
    const auth = "Basic " + Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString("base64");
    const res = await fetch("https://zoom.us/oauth/token", {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${base}/api/zoom/callback` }),
    });
    if (!res.ok) throw new Error(`token exchange ${res.status}`);
    const t = await res.json();
    let email: string | null = null;
    try {
      const me = await fetch("https://api.zoom.us/v2/users/me", { headers: { Authorization: `Bearer ${t.access_token}` } });
      if (me.ok) email = (await me.json()).email ?? null;
    } catch { /* email is best-effort */ }
    await saveZoomConnection({
      staffId, accountEmail: email,
      accessToken: t.access_token, refreshToken: t.refresh_token,
      tokenExpiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    });
  } catch (e) {
    console.error("[zoom] callback failed:", (e as Error).message);
    return NextResponse.redirect(`${back}?zoom=error`);
  }
  return NextResponse.redirect(`${back}?zoom=connected`);
}
