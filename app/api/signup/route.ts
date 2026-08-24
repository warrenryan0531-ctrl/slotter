import { NextResponse } from "next/server";
import { isMarket } from "@/lib/edition";
import { startSignup } from "@/lib/signup";
import { rateLimit, ipOf } from "@/lib/ratelimit";

// Market-edition signup, step 1: park the pending business + email a code. No tenant is created
// until the code is verified (H1). R6: hard-gated to the market edition in the handler.
export async function POST(req: Request) {
  if (!isMarket()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await rateLimit(`signup:${ipOf(req)}`, 3600, 10))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const body = await req.json().catch(() => null) as
    | { businessName?: string; slug?: string; tz?: string; ownerName?: string; ownerEmail?: string } | null;
  if (!body?.businessName || !body.slug || !body.ownerEmail) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  const r = await startSignup({
    businessName: body.businessName, slug: body.slug, tz: body.tz, ownerName: body.ownerName, ownerEmail: body.ownerEmail,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === "slug_taken" ? 409 : 400 });
  return NextResponse.json({ ok: true });
}
