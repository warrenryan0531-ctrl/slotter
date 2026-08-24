import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { setPrefs, type Prefs, type ThemeScope } from "@/lib/prefs";

// Save the signed-in user's dashboard appearance (accent + background).
// Scoped owner|admin so one person can theme their two views independently.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { scope?: string; accent?: string; background?: string };
  const scope: ThemeScope = body.scope === "admin" ? "admin" : "owner";

  // A user can only theme a view they can actually see.
  if (scope === "admin" && session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (scope === "owner" && !session.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const patch: Partial<Prefs> = {};
  if (typeof body.accent === "string") patch.accent = body.accent;
  if (typeof body.background === "string") patch.background = body.background;

  const prefs = await setPrefs(scope, session.email, patch);
  return NextResponse.json({ ok: true, prefs });
}
