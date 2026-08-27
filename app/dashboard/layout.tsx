import Link from "next/link";
import { getSession } from "@/lib/auth";
import { appMode } from "@/lib/env";
import { tenantById, allServices, staffForTenant } from "@/lib/repo";
import { LoginForm } from "@/components/dash";
import { DashShell, type Tab } from "@/components/nav";
import { isMarket } from "@/lib/edition";
import { getPrefs } from "@/lib/prefs";

export const dynamic = "force-dynamic";

function initialsFrom(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "•";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) return <LoginForm demoHint={appMode() === "demo"} />;
  if (!session.tenantId) {
    // admin without impersonation → send to admin home
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="card card-pad text-center">
          <p className="mb-4 text-[#55655d]">You&apos;re signed in as an administrator.</p>
          <Link href="/admin" className="btn btn-primary">Go to admin →</Link>
        </div>
      </main>
    );
  }
  const tenant = await tenantById(session.tenantId);
  const services = await allServices(session.tenantId);
  const hasGroup = services.some((s) => s.is_group);
  const staff = await staffForTenant(session.tenantId).catch(() => []);
  const owner =
    staff.find((s) => s.email?.toLowerCase() === session.email.toLowerCase()) ??
    staff.find((s) => s.is_owner) ??
    staff[0];
  const ownerLabel = owner?.name ?? session.email;
  const brand = tenant?.name ?? "Dashboard";
  const prefs = await getPrefs("owner", session.email);

  const tabs: Tab[] = [
    { href: "/dashboard", label: "Today", icon: "today" },
    { href: "/dashboard/onboarding", label: "Setup", icon: "setup" },
    { href: "/dashboard/bookings", label: "Bookings", icon: "bookings" },
    { href: "/dashboard/reports", label: "Reports", icon: "reports" },
    ...(hasGroup ? [{ href: "/dashboard/classes", label: "Classes", icon: "classes" } as Tab] : []),
    { href: "/dashboard/availability", label: "Availability", icon: "availability" },
    { href: "/dashboard/services", label: "Services", icon: "services" },
    { href: "/dashboard/settings", label: "Settings", icon: "settings" },
    { href: "/dashboard/embed", label: "Add to your site", icon: "embed" },
    ...(isMarket() ? [{ href: "/dashboard/billing", label: "Billing", icon: "billing" } as Tab] : []),
  ];

  const impersonating = session.impersonating ? (
    <div className="bg-amber-400 py-1.5 text-center text-sm font-semibold text-amber-950" data-testid="impersonation-banner">
      ADMIN — viewing {tenant?.name} · <Link className="underline" href="/admin">back to admin</Link>
    </div>
  ) : undefined;

  return (
    <DashShell
      brand={brand}
      initials={initialsFrom(ownerLabel === session.email ? brand : ownerLabel)}
      ownerLabel={ownerLabel}
      tabs={tabs}
      impersonating={impersonating}
      accent={prefs.accent}
      background={prefs.background}
    >
      {children}
    </DashShell>
  );
}
