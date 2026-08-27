"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/dash";

/* ---- Inline icon set (no icon dependency) ---- */
const I = {
  today: "M3 10.5 12 3l9 7.5M5 9.5V20a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V9.5",
  setup: "M12 3v2m0 14v2m9-9h-2M5 12H3m14.5-6.5-1.4 1.4M7.9 16.1l-1.4 1.4m0-11.9 1.4 1.4m8.2 8.2 1.4 1.4M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z",
  bookings: "M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm3 8h3m5 0h.01M8 17h.01M12 17h.01",
  classes: "M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11",
  availability: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  services: "M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.6a1 1 0 0 1 .7.3l7.3 7.3a1.4 1.4 0 0 1 0 2ZM7.5 8h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-2.2-1.3L14.5 2h-4l-.4 2.6a7.3 7.3 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 2.2 1.3l.4 2.6h4l.4-2.6a7.3 7.3 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.06-.42.1-.86.1-1.3Z",
  embed: "M8 9l-4 3 4 3m8-6 4 3-4 3M14 4l-4 16",
  billing: "M3 10h18M5 6h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm2 9h4",
  reports: "M3 21h18M6 21v-9m5 9V6m5 15v-6",
} as const;

export type IconKey = keyof typeof I;

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: IconKey; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={I[name]} />
    </svg>
  );
}

export type Tab = { href: string; label: string; icon: IconKey };

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
}

function NavLinks({ tabs, pathname, onNavigate }: { tabs: Tab[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {tabs.map((t) => {
        const active = isActive(pathname, t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-brand-600 text-white glow-pill"
                : "text-[#55655d] hover:bg-brand-50 hover:text-brand-800"
            }`}
          >
            <Icon name={t.icon} className={`h-[18px] w-[18px] ${active ? "text-white" : "text-[#8aa39a] group-hover:text-brand-700"}`} />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600 text-white glow-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
          <path d="M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
          <path d="m9 14 2 2 4-4" />
        </svg>
      </span>
      <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
    </div>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
      {initials}
    </span>
  );
}

export function DashShell({
  brand,
  initials,
  ownerLabel,
  tabs,
  impersonating,
  accent = "teal",
  background = "mint",
  children,
}: {
  brand: string;
  initials: string;
  ownerLabel: string;
  tabs: Tab[];
  impersonating?: React.ReactNode;
  accent?: string;
  background?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--background)]" data-accent={accent} data-bg={background}>
      {impersonating}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-[var(--border)] bg-white px-4 py-5 md:flex">
        <div className="px-1.5">
          <Brand name={brand} />
        </div>
        <div className="mt-7 flex-1 overflow-y-auto">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[#9aa8a1]">Menu</p>
          <NavLinks tabs={tabs} pathname={pathname} />
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[#fafcfb] p-2.5">
          <Avatar initials={initials} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{ownerLabel}</p>
            <LogoutButton />
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[var(--border)] bg-white/85 px-4 py-3 backdrop-blur md:hidden">
        <Brand name={brand} />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={open}
          className="grid h-10 w-10 place-items-center rounded-xl border border-[var(--border)] text-[#55655d]"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-5 w-5" aria-hidden>
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </header>
      {open && (
        <div className="border-b border-[var(--border)] bg-white px-4 py-3 md:hidden">
          <NavLinks tabs={tabs} pathname={pathname} onNavigate={() => setOpen(false)} />
          <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
            <Avatar initials={initials} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{ownerLabel}</p>
              <LogoutButton />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="md:pl-64">
        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-9">{children}</main>
      </div>
    </div>
  );
}
