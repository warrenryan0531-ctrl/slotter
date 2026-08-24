import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isMarket } from "@/lib/edition";
import { startBillingCheckout } from "@/lib/billing";
import * as repo from "@/lib/repo";
import { captureError } from "@/lib/observe";

export const dynamic = "force-dynamic";

// Start a plan upgrade (market edition only). Returns a URL to redirect the owner to.
export async function POST(req: Request) {
  if (!isMarket()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? new URL(req.url).origin;
  try {
    const { url } = await startBillingCheckout(tenant, base);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    captureError("billing.checkout", e, { tenantId: tenant.id });
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
