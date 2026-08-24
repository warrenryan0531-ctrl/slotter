import { NextResponse } from "next/server";
import { isMarket } from "@/lib/edition";
import { verifySignup } from "@/lib/signup";
import { rateLimit, ipOf } from "@/lib/ratelimit";

// Market-edition signup, step 2: verify the emailed code, then create the business + sign in.
export async function POST(req: Request) {
  if (!isMarket()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await rateLimit(`signupverify:${ipOf(req)}`, 3600, 30))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as { email?: string; code?: string } | null;
  if (!body?.email || !body.code) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const r = await verifySignup(body.email, body.code);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true, slug: r.slug });
}
