import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appMode } from "@/lib/env";
import { EDITION } from "@/lib/edition";

export const dynamic = "force-dynamic";

// Health/readiness probe (H3). Confirms the app is up and the database is reachable.
// Returns 200 when healthy, 503 when the DB check fails. Never leaks secrets.
export async function GET() {
  let dbOk = false;
  try {
    const { error } = await db().from("bh_tenants").select("id", { head: true, count: "exact" }).limit(1);
    dbOk = !error;
  } catch { dbOk = false; }
  const body = { ok: dbOk, mode: appMode(), edition: EDITION, db: dbOk ? "up" : "down", ts: new Date().toISOString() };
  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
