import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { LoginForm } from "@/components/dash";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Demo-mode mail viewer. Gated behind a session + PII masked (review resolution #3).
function maskEmail(e: string): string {
  const [u, d] = e.split("@");
  return `${u?.[0] ?? "•"}***@${d?.[0] ?? "•"}***`;
}
function maskHtml(html: string): string {
  // truncate manage links + mask contact PII so demo viewers can't harvest it (resolution #3)
  return html
    .replace(/(\/manage\/)[A-Za-z0-9_-]{8,}/g, "$1••••••••")
    .replace(/tel:[+\d().\- ]{7,}/g, "tel:•••")
    .replace(/\(\d{3}\)\s?\d{3}-\d{4}/g, "(•••) •••-••••")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m));
}

export default async function OutboxPage() {
  const session = await getSession();
  if (!session) return <LoginForm />;
  let q = db().from("bh_outbox_emails").select("*").order("created_at", { ascending: false }).limit(30);
  if (session.role !== "admin" && session.tenantId) q = q.eq("tenant_id", session.tenantId);
  const { data: emails } = await q;

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-gray-900 text-white px-4 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between">
          <h1 className="font-bold">Demo outbox</h1>
          <Link href="/dashboard" className="text-sm underline text-gray-300">← dashboard</Link>
        </div>
      </header>
      <div className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-gray-500 mb-4">In the live product these are real emails (from your own domain) with calendar invites attached. In demo mode they land here so you can see exactly what the owner and customer receive. Contact details are masked.</p>
        <div className="space-y-3">
          {(emails ?? []).map((e) => (
            <details key={e.id} className="rounded-xl bg-white border border-gray-200 p-4" data-testid="outbox-email">
              <summary className="cursor-pointer">
                <span className="font-medium">{e.subject}</span>
                <span className="block text-xs text-gray-400">to {maskEmail(e.to_addr)} · {new Date(e.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}{e.ics_text ? " · 📅 .ics attached" : ""}</span>
              </summary>
              <div className="mt-3 border-t border-gray-100 pt-3 text-sm" dangerouslySetInnerHTML={{ __html: maskHtml(e.html) }} />
              {e.ics_text && (
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">View calendar invite (.ics)</summary>
                  <pre className="mt-1 text-[10px] bg-gray-50 rounded p-2 overflow-x-auto">{maskHtml(e.ics_text)}</pre>
                </details>
              )}
            </details>
          ))}
          {(emails ?? []).length === 0 && <p className="text-gray-500 text-sm">No emails yet — make a booking on your booking page and watch this fill up.</p>}
        </div>
      </div>
    </main>
  );
}
