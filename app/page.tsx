import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { isMarket } from "@/lib/edition";

export const dynamic = "force-dynamic";

function DemoCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block rounded-xl bg-white/5 border border-white/10 p-4 hover:border-indigo-400">
      <span className="font-medium">{title}</span>
      <span className="block text-sm text-gray-400">{desc}</span>
    </Link>
  );
}

export default function Home() {
  if (isMarket()) return <Marketing />;
  return (
    <main className="min-h-screen bg-gray-950 text-white">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-sm font-semibold text-indigo-400 mb-2">OPEN-SOURCE BOOKING</p>
        <h1 className="text-3xl font-bold mb-3">{APP_NAME}</h1>
        <p className="text-gray-300 mb-8">
          A branded, embeddable booking widget for any website. Customers pick a service and a time;
          it lands on the owner&apos;s calendar (Google, Outlook, iPhone, even Yahoo), and the owner gets notified.
          Self-hostable — bring your own database.
        </p>
        <h2 className="font-semibold text-lg mb-3">Live demo businesses</h2>
        <div className="space-y-3 mb-10">
          <DemoCard href="/b/coastal-shine" title="Coastal Shine Mobile Detailing" desc="On-site appointments, callbacks, two staff, intake questions" />
          <DemoCard href="/b/rivera-law" title="Rivera Law" desc="Solo attorney — phone consultations booked straight onto her calendar" />
          <DemoCard href="/b/riverside-yoga" title="Riverside Yoga Studio" desc="Group classes — reserve a seat, live seats-remaining, waitlist when full" />
          <a href="/embed-demo.html" className="block rounded-xl bg-white/5 border border-white/10 p-4 hover:border-indigo-400">
            <span className="font-medium">Embedded widget demo</span>
            <span className="block text-sm text-gray-400">The same booking flow dropped into a &quot;client&apos;s&quot; existing site</span>
          </a>
        </div>
        <h2 className="font-semibold text-lg mb-3">For business owners</h2>
        <Link href="/dashboard" className="inline-block rounded-xl bg-indigo-500 px-5 py-3 font-semibold">Owner dashboard →</Link>
        <p className="text-xs text-gray-500 mt-3">Demo login: owner@coastalshine.demo (or maria@riveralaw.demo) · code 123456</p>
      </div>
    </main>
  );
}

function Marketing() {
  const features = [
    ["Instant or by-request", "Auto-confirm bookings, or approve each one first. Your call, per service."],
    ["Takes deposits", "Collect a deposit or full payment through your own Stripe. Cuts no-shows."],
    ["Group classes", "Sell seats with live capacity and an automatic waitlist when a class fills."],
    ["Two-way calendar sync", "Reads your Google or Outlook calendar so you never get double-booked."],
    ["Text + email reminders", "Confirmations and reminders by email and SMS, automatically."],
    ["Embeds anywhere", "One line of code drops it onto your site — or share a link."],
  ];
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <header className="mx-auto max-w-5xl px-6 py-5 flex items-center justify-between">
        <span className="font-bold text-lg">{APP_NAME}</span>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/dashboard" className="text-gray-600">Sign in</Link>
          <Link href="/signup" className="rounded-lg bg-indigo-600 text-white px-4 py-2 font-semibold" data-testid="nav-start">Start free</Link>
        </nav>
      </header>

      <section className="mx-auto max-w-3xl px-6 pt-12 pb-16 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-4">Online booking that lives on <span className="text-indigo-600">your</span> website.</h1>
        <p className="text-lg text-gray-600 mb-8">Let customers book appointments, calls, and classes in a few taps. Deposits, reminders, and calendar sync included — no per-seat fees.</p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/signup" className="rounded-xl bg-indigo-600 text-white px-6 py-3 font-semibold" data-testid="hero-start">Create your booking page — free</Link>
          <Link href="/b/coastal-shine" className="rounded-xl border border-gray-300 px-6 py-3 font-semibold">See a live demo</Link>
        </div>
      </section>

      <section className="bg-gray-50 border-y border-gray-100">
        <div className="mx-auto max-w-5xl px-6 py-14 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(([t, d]) => (
            <div key={t} className="rounded-xl bg-white border border-gray-200 p-5">
              <h3 className="font-semibold mb-1">{t}</h3>
              <p className="text-sm text-gray-600">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-16 text-center">
        <h2 className="text-2xl font-bold mb-3">Ready in about a minute.</h2>
        <p className="text-gray-600 mb-6">Name your business, set your hours, add a service. That&apos;s it — you&apos;re taking bookings.</p>
        <Link href="/signup" className="rounded-xl bg-indigo-600 text-white px-6 py-3 font-semibold">Get started free</Link>
      </section>

      <footer className="border-t border-gray-100 text-center text-sm text-gray-500 py-8">© {APP_NAME}</footer>
    </main>
  );
}
