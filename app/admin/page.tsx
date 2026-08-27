import { getSession } from "@/lib/auth";
import { appMode } from "@/lib/env";
import { db } from "@/lib/db";
import { AdminImpersonate, LoginForm, CreateTenant, LogoutButton } from "@/components/dash";
import { ThemePicker } from "@/components/theme";
import { getPrefs } from "@/lib/prefs";
import { isAgency } from "@/lib/edition";
import { APP_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) return <LoginForm demoHint={appMode() === "demo"} />;
  if (session.role !== "admin") {
    return <main className="min-h-screen flex items-center justify-center"><p className="text-[#64726b]" data-testid="admin-forbidden">403 — admin only.</p></main>;
  }
  const { data: tenants } = await db().from("bh_tenants").select("id, slug, name, created_at").order("created_at");
  const counts = new Map<string, number>();
  for (const t of tenants ?? []) {
    const { count } = await db().from("bh_bookings").select("id", { count: "exact", head: true }).eq("tenant_id", t.id);
    counts.set(t.id, count ?? 0);
  }
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const prefs = await getPrefs("admin", session.email);

  return (
    <main className="min-h-screen bg-[var(--background)]" data-accent={prefs.accent} data-bg={prefs.background}>
      <header className="border-b border-[var(--border)] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white glow-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
                <path d="M12 3 4 7v5c0 4.5 3.2 7.7 8 9 4.8-1.3 8-4.5 8-9V7l-8-4Z" /><path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <h1 className="font-semibold text-ink">{APP_NAME} — Admin</h1>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <section>
          <h2 className="mb-1 text-lg font-semibold text-ink">Appearance</h2>
          <p className="mb-3 text-sm text-[#64726b]">Theme your admin view — saved just for you, separate from any business dashboard.</p>
          <div className="card card-pad">
            <ThemePicker scope="admin" accent={prefs.accent} background={prefs.background} />
          </div>
        </section>

        {isAgency() && <CreateTenant />}

        <section className="space-y-2">
          <h2 className="mb-1 text-lg font-semibold text-ink">Businesses</h2>
          {(tenants ?? []).map((t) => (
            <div key={t.id} className="card flex items-center justify-between gap-3 p-4" data-testid={`tenant-${t.slug}`}>
              <div>
                <p className="font-semibold text-ink">{t.name}</p>
                <p className="text-sm text-[#64726b]">{base}/b/{t.slug} · {counts.get(t.id)} bookings</p>
              </div>
              <AdminImpersonate tenantId={t.id} name={t.name} />
            </div>
          ))}
          {(tenants ?? []).length === 0 && <p className="text-sm text-[#64726b]">No businesses yet.</p>}
        </section>
      </div>
    </main>
  );
}
