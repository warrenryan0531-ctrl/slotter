import { NextResponse } from "next/server";
import { issueCode } from "@/lib/auth";
import { rateLimit, ipOf } from "@/lib/ratelimit";

export async function POST(req: Request) {
  if (!(await rateLimit(`auth-req:${ipOf(req)}`, 600, 30))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  await issueCode(email);
  // uniform response regardless of whether the email exists (resolution #4)
  return NextResponse.json({ ok: true });
}
