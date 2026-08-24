import { NextResponse } from "next/server";
import { verifyCode, createSession } from "@/lib/auth";
import { rateLimit, ipOf } from "@/lib/ratelimit";

export async function POST(req: Request) {
  if (!(await rateLimit(`auth-verify:${ipOf(req)}`, 600, 60))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const session = await verifyCode(email, code);
  if (!session) return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  await createSession(session);
  return NextResponse.json({ ok: true, role: session.role });
}
