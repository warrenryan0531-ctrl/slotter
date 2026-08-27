import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { computeReport } from "@/lib/reports";
import { fmtInTz } from "@/lib/engine/tz";

export const dynamic = "force-dynamic";

// Field escaping. Two jobs:
//  1) RFC-4180: quote if it contains comma/quote/newline; double internal quotes.
//  2) CSV formula-injection defense: a customer-entered value beginning with = + - @ (or a
//     leading tab/CR) can execute as a formula when the owner opens the file in Excel/Sheets.
//     Neutralize by prefixing a single quote so it renders as text, never a formula.
function csv(v: string | number): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// B4: CSV of the bookings in a date range. Session-gated + tenant-scoped (computeReport filters by
// the session's tenant). Opens cleanly in Excel (UTF-8 BOM + CRLF).
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.tenantId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  let report;
  try {
    report = await computeReport(tenant.id, from, to, tenant.tz);
  } catch {
    return NextResponse.json({ error: "bad_range" }, { status: 400 });
  }

  const [services, staff] = await Promise.all([repo.allServices(tenant.id), repo.staffForTenant(tenant.id)]);
  const svcName = new Map(services.map((s) => [s.id, s.name] as const));
  const staffName = new Map(staff.map((s) => [s.id, s.name] as const));

  const header = ["Date", "Time", "Service", "Team member", "Customer", "Email", "Phone", "Status", "No-show", "Payment", "Amount ($)"];
  const lines = [header.map(csv).join(",")];
  for (const b of report.rows) {
    const ms = Date.parse(b.starts_at);
    const date = fmtInTz(ms, tenant.tz, { year: "numeric", month: "2-digit", day: "2-digit" });
    const time = fmtInTz(ms, tenant.tz, { hour: "numeric", minute: "2-digit" });
    const amount = ((b.payment_status === "paid" ? (b.deposit_cents ?? 0) : 0) + (b.fee_charged_cents ?? 0)) / 100;
    lines.push([
      date, time, svcName.get(b.service_id) ?? "", staffName.get(b.staff_id) ?? "",
      b.customer?.name ?? "", b.customer?.email ?? "", b.customer?.phone ?? "",
      b.status, b.no_show ? "yes" : "", b.payment_status, amount.toFixed(2),
    ].map(csv).join(","));
  }

  const body = "﻿" + lines.join("\r\n"); // BOM so Excel detects UTF-8
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bookings_${from}_to_${to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
