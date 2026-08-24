// Plain server components (no "use client") — in-product, zero-jargon walkthroughs for the
// steps a business owner sets up themselves. Uses native <details>/<summary> so it works with
// no JavaScript and stays accessible. Reused on the Setup Guide and inline where the action lives.
import { APP_NAME } from "@/lib/brand";

function Guide({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-xl border border-brand-200 bg-brand-50/60 open:bg-brand-50">
      <summary className="cursor-pointer list-none select-none px-4 py-3 flex items-center gap-2 font-medium text-brand-900">
        <span aria-hidden className="text-brand-600 transition-transform group-open:rotate-90">▶</span>
        {title}
      </summary>
      <div className="px-4 pb-4 pt-1 text-sm text-[#42504a] space-y-3 leading-relaxed">{children}</div>
    </details>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-brand-600 text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** The star walkthrough: connecting Google/Outlook, written for someone who's never done it —
 *  including the "unverified app" screen that scares people off, and the two-checkbox gotcha. */
export function CalendarConnectGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Guide title="How connecting your calendar works — a 2-minute walkthrough" defaultOpen={defaultOpen}>
      <p><strong>What this does:</strong> two things, automatically. When you&apos;re busy on your own
        calendar, those times disappear from your booking page so you never get double-booked. And every
        new booking is added straight to your calendar. Nothing to install.</p>
      <p className="font-medium text-gray-900">Step by step:</p>
      <ol className="space-y-2">
        <Step n={1}>Click <strong>Connect Google</strong> (or <strong>Connect Outlook</strong>) below.</Step>
        <Step n={2}>Choose the account where you actually keep your calendar, and sign in if it asks.</Step>
        <Step n={3}>
          You may see a screen that says <em>&ldquo;Google hasn&apos;t verified this app.&rdquo;</em>{" "}
          <strong>This is normal and safe</strong> — it just means {APP_NAME} is your private booking tool,
          not a public app in Google&apos;s store. Click <strong>Advanced</strong> at the bottom-left, then
          <strong> &ldquo;Go to {APP_NAME} (unsafe)&rdquo;</strong>. (Outlook shows a simple &ldquo;Accept&rdquo; instead.)
        </Step>
        <Step n={4}>
          On the permissions screen, make sure <strong>both</strong> boxes are checked — one to see your
          calendar, one to add events — then click <strong>Continue</strong>. Both are needed: one keeps
          you from being double-booked, the other puts bookings on your calendar.
        </Step>
        <Step n={5}>That&apos;s it. You&apos;ll land right back here and see <strong>&ldquo;Connected.&rdquo;</strong></Step>
      </ol>
      <p className="text-gray-600">Changed your mind? You can <strong>Disconnect</strong> anytime — it never
        touches or deletes anything already on your calendar.</p>
      <p className="text-gray-600"><strong>Didn&apos;t work?</strong> Usually it&apos;s the two checkboxes in
        step 4 — reconnect and make sure both are ticked.</p>
    </Guide>
  );
}

/** Deposits / paid bookings — what it is, and the one step people forget (the webhook). */
export function DepositsGuide({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <Guide title="How taking deposits works — read before you turn it on" defaultOpen={defaultOpen}>
      <p><strong>What this does:</strong> collect a deposit (or full payment) the moment someone books, so a
        no-show doesn&apos;t cost you a slot for nothing. The money goes <strong>straight into your own
        Stripe account</strong> — {APP_NAME} never holds or touches it.</p>
      <p className="font-medium text-gray-900">What you&apos;ll need:</p>
      <ol className="space-y-2">
        <Step n={1}>A free <strong>Stripe</strong> account (stripe.com) — this is where your money lands.</Step>
        <Step n={2}>Your Stripe <strong>keys</strong> (Stripe dashboard → Developers → API keys).</Step>
        <Step n={3}>
          A Stripe <strong>webhook</strong> so a booking confirms the instant payment clears. <strong>This is
          the step people miss</strong> — skip it and customers get charged but their booking never
          confirms. It takes 30 seconds and we&apos;ll give you the exact address to paste.
        </Step>
        <Step n={4}>Turn on <strong>&ldquo;Require a deposit&rdquo;</strong> for any service, and set the amount.</Step>
      </ol>
      <p className="rounded-lg bg-white border border-brand-200 px-3 py-2 text-[#42504a]">
        <strong>Not comfortable with the technical bits?</strong> This is the one step your {APP_NAME} team is
        happy to set up <em>with</em> you on a quick call — just ask. Everything else on this page you can do
        yourself.</p>
    </Guide>
  );
}
