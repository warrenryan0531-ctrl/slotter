import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { createIntakeDownload } from "@/lib/storage";

export const dynamic = "force-dynamic";

// B5: owner-only download of an intake file. Session-gated, and the object path MUST live under this
// owner's own tenant slug — so an owner can never fetch another tenant's uploads by guessing a path.
// Returns a short-lived signed URL redirect; the private bucket is never publicly readable.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const path = new URL(req.url).searchParams.get("path") ?? "";
  // Ownership: path is `<slug>/<uuid>/<name>`; the first segment must equal this tenant's slug.
  if (!path || !path.startsWith(`${tenant.slug}/`) || path.includes("..")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const url = await createIntakeDownload(path, 60);
    return NextResponse.redirect(url);
  } catch (e) {
    console.error("[b5] file download failed:", (e as Error).message);
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
}
