import Link from "next/link";
import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { listConnections } from "@/lib/calendar";
import { CopyButton, AiSetupDoc } from "@/components/dash";
import { CalendarConnectGuide, DepositsGuide } from "@/components/guides";
import { aiSetupDoc } from "@/lib/ai-setup";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const staff = await repo.staffForTenant(tenant.id);
  const services = await repo.allServices(tenant.id);
  const owner = staff.find((s) => s.email?.toLowerCase() === session.email.toLowerCase()) ?? staff.find((s) => s.is_owner) ?? staff[0];
  const rules = owner ? await repo.rulesForStaff(owner.id) : [];
  const conns = owner ? await listConnections(owner.id) : [];
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const snippet = `<script src="${base}/widget.js" data-tenant="${tenant.slug}" async></script>`;

  const hoursDone = rules.length > 0;
  const servicesDone = services.length > 0;
  const calendarDone = conns.length > 0;
  const depositsOn = services.some((s) => s.requires_payment);
  const aiDoc = aiSetupDoc({ tenant, baseUrl: base, state: { hoursDone, servicesDone, calendarDone, depositsOn } });

  // Required steps for "you're live" (deposits + SMS are optional add-ons, not gating).
  const required = [hoursDone, servicesDone];
  const doneCount = required.filter(Boolean).length;
  const live = required.every(Boolean);

  return (
    <div className="space-y-6" data-testid="onboarding">
      <div>
        <h2 className="font-semibold text-xl mb-1">Get {tenant.name} taking bookings 👋</h2>
        <p className="text-sm text-gray-600">
          No tech experience needed — just work down this list. Each step tells you exactly what to do.
        </p>
      </div>

      {/* Set up with your AI — the fastest path for a non-technical owner */}
      <section className="rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5" data-testid="ai-setup">
        <h3 className="font-semibold text-lg text-brand-900 flex items-center gap-2">🤖 Rather have your AI set this up?</h3>
        <p className="text-sm text-brand-800 mt-1 mb-3">
          Use ChatGPT, Claude, Gemini, or any AI assistant? Copy the note below and paste it into your AI
          chat. It instantly tells your AI everything about your booking page and turns it into a friendly
          guide that walks you through the whole setup — step by step, in plain English. No secrets or
          passwords are included, so it&apos;s safe to share.
        </p>
        <AiSetupDoc text={aiDoc} filename={`${tenant.slug}-booking-setup.md`} />
      </section>

      {/* progress */}
      <div>
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="font-medium text-gray-800">{live ? "You're live! 🎉" : "The 2 must-do steps"}</span>
          <span className="text-gray-600">{doneCount} of {required.length} done</span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#e2e9e5] overflow-hidden">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${(doneCount / required.length) * 100}%` }} />
        </div>
      </div>

      <ol className="space-y-3">
        {/* 1. Hours */}
        <StepCard n={1} done={hoursDone} title="Set your weekly hours"
          body="Tell customers the days and times you're open. Slots only ever show inside these hours."
          href="/dashboard/availability" cta={hoursDone ? "Edit hours" : "Set hours"} />

        {/* 2. Services */}
        <StepCard n={2} done={servicesDone} title="Add what people can book"
          body="A service is anything someone books — a 30-minute call, an on-site visit, a class. Add at least one; you can change it anytime."
          href="/dashboard/services" cta={servicesDone ? "Edit services" : "Add a service"} />

        {/* 3. Calendar (recommended) */}
        <StepCard n={3} done={calendarDone} optional="Recommended" title="Connect your calendar"
          body="The big one for peace of mind: it stops double-bookings and drops every booking onto your own calendar automatically."
          href="/dashboard/availability" cta={calendarDone ? "Manage calendar" : "Connect calendar"}>
          {!calendarDone && <CalendarConnectGuide defaultOpen />}
        </StepCard>

        {/* 4. Deposits (optional) */}
        <StepCard n={4} done={depositsOn} optional="Optional" title="Take deposits (optional)"
          body="Charge a deposit or full payment at booking so no-shows don't sting. The money goes to your own Stripe account."
          href="/dashboard/services" cta={depositsOn ? "Edit deposits" : "Set up deposits"}>
          <DepositsGuide />
        </StepCard>

        {/* 5. Put it on your site */}
        <StepCard n={5} done={false} optional="When you're ready" title="Put booking on your website"
          body="Paste this one line into your site where you want the booking button. No coding — it just works. (Or share your booking link anywhere.)"
          href="/dashboard/embed" cta="More ways to share">
          <div className="mt-1 flex items-center gap-2">
            <code className="block text-xs bg-white border border-[#e4ebe7] rounded-lg p-2 overflow-x-auto whitespace-pre flex-1">{snippet}</code>
            <CopyButton text={snippet} />
          </div>
        </StepCard>
      </ol>

      <div className="flex flex-wrap gap-2 pt-1">
        <Link href={`/b/${tenant.slug}`} className="btn btn-primary">See your booking page →</Link>
        <Link href="/dashboard" className="btn btn-secondary">Go to dashboard</Link>
      </div>
    </div>
  );
}

function StepCard(p: {
  n: number; done: boolean; title: string; body: string; href: string; cta: string;
  optional?: string; children?: React.ReactNode;
}) {
  return (
    <li className={`rounded-xl p-4 ${p.done ? "border border-brand-200 bg-brand-50" : "card"}`}>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${p.done ? "bg-brand-600 text-white" : "bg-[#e2e9e5] text-[#55655d]"}`}>{p.done ? "✓" : p.n}</div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink flex items-center gap-2">
            {p.title}
            {p.optional && !p.done && <span className="rounded-full bg-[#eef2f0] text-[#4b5a53] text-xs font-normal px-2 py-0.5">{p.optional}</span>}
          </p>
          <p className="text-sm text-[#64726b]">{p.body}</p>
        </div>
        <Link href={p.href} className="btn btn-secondary btn-sm shrink-0">{p.cta}</Link>
      </div>
      {p.children && <div className="mt-3 ml-9">{p.children}</div>}
    </li>
  );
}
