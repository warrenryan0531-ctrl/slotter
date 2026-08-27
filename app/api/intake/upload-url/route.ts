import { NextResponse } from "next/server";
import * as repo from "@/lib/repo";
import { db } from "@/lib/db";
import { rateLimit, ipOf } from "@/lib/ratelimit";
import { createIntakeUpload, INTAKE_MAX_BYTES, INTAKE_MIME } from "@/lib/storage";

export const dynamic = "force-dynamic";

// B5: mint a scoped signed upload URL for one intake file. Public (customers upload before a booking
// exists) but validated: the slug must be a real tenant, and only images/PDF up to 10MB are allowed.
// The client uploads the bytes directly to the returned URL, so nothing large hits this function.
export async function POST(req: Request) {
  // Public endpoint → keep the per-IP budget modest (abuse/cost guard; see B5 review finding #1).
  if (!(await rateLimit(`upload:${ipOf(req)}`, 300, 12))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const slug = String(body.slug ?? "").trim();
  const filename = String(body.filename ?? "").trim();
  const contentType = String(body.contentType ?? "").trim().toLowerCase();
  const size = Number(body.size ?? 0);
  if (!slug || !filename) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!INTAKE_MIME.has(contentType)) return NextResponse.json({ error: "bad_type" }, { status: 400 });
  if (!Number.isFinite(size) || size <= 0 || size > INTAKE_MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 400 });

  const tenant = await repo.tenantBySlug(slug);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Per-tenant budget: bounds abuse targeting ONE tenant across many IPs (the per-IP limit alone
  // doesn't). 90 signed URLs / 10 min is far above any real booking-form use.
  if (!(await rateLimit(`upload:slug:${slug}`, 600, 90))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const up = await createIntakeUpload(slug, filename);
    // Track the minted upload so the orphan sweep can GC it if no booking ever references it.
    try { await db().from("bh_intake_uploads").insert({ path: up.path, tenant_slug: slug }); }
    catch (e) { console.error("[b5] upload tracking insert failed:", (e as Error).message); }
    return NextResponse.json({ path: up.path, signedUrl: up.signedUrl, token: up.token, name: up.name });
  } catch (e) {
    console.error("[b5] upload-url failed:", (e as Error).message);
    return NextResponse.json({ error: "upload_unavailable" }, { status: 500 });
  }
}
