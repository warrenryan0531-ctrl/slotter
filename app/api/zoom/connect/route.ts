import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { newToken } from "@/lib/auth";
import { zoomConfigured } from "@/lib/meetings";

export const dynamic = "force-dynamic";

// Start the Zoom OAuth flow for the signed-in owner (mirrors /api/calendar/connect).
async function ownerStaffId(tenantId: string, email: string): Promise<string | null> {
  const { data } = await db().from("bh_staff").select("id, email, is_owner").eq("tenant_id", tenantId);
  const rows = (data as { id: string; email: string | null; is_owner: boolean }[]) ?? [];
  return rows.find((s) => s.email?.toLowerCase() === email.toLowerCase())?.id
    ?? rows.find((s) => s.is_owner)?.id ?? null;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  const back = `${base}/dashboard/availability`;
  if (!zoomConfigured()) return NextResponse.redirect(`${back}?zoom=unconfigured`);

  const staffId = await ownerStaffId(session.tenantId, session.email);
  if (!staffId) return NextResponse.redirect(`${back}?zoom=error`);

  // CSRF: stash staffId + nonce in a short-lived httpOnly cookie; echo the nonce in state.
  const nonce = newToken();
  const state = Buffer.from(JSON.stringify({ staffId, nonce })).toString("base64url");
  (await cookies()).set("zoom_oauth", JSON.stringify({ nonce, staffId }), { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/" });

  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ZOOM_CLIENT_ID!,
    redirect_uri: `${base}/api/zoom/callback`,
    state,
  });
  return NextResponse.redirect(`https://zoom.us/oauth/authorize?${p}`);
}
