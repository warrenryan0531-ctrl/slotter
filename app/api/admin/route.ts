import { NextResponse } from "next/server";
import { getSession, createSession } from "@/lib/auth";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  if (body.action === "impersonate") {
    const tenantId = String(body.tenantId ?? "");
    const { data } = await db().from("bh_tenants").select("id").eq("id", tenantId).limit(1);
    if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
    await createSession({ email: session.email, role: "admin", tenantId, impersonating: true });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "stop_impersonate") {
    await createSession({ email: session.email, role: "admin", tenantId: null });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "create_tenant") {
    const { slug, name, tz, ownerName, ownerEmail } = body as Record<string, string>;
    if (!slug || !name || !ownerEmail) return NextResponse.json({ error: "missing fields" }, { status: 400 });
    const { data, error } = await db().rpc("bh_create_tenant", {
      p_slug: slug, p_name: name, p_tz: tz || "America/New_York", p_owner_name: ownerName || "Owner", p_owner_email: ownerEmail,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: data });
  }
  return NextResponse.json({ error: "bad_action" }, { status: 400 });
}
