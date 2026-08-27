import { getSession } from "@/lib/auth";
import * as repo from "@/lib/repo";
import { tenantSettings } from "@/lib/types";
import { SettingsForm, CopyButton, DashAction, RemindersForm, FeatureToggle, ReviewRequestForm } from "@/components/dash";
import { ThemePicker, BookingColorPicker } from "@/components/theme";
import { getPrefs } from "@/lib/prefs";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session?.tenantId) return null;
  const tenant = await repo.tenantById(session.tenantId);
  if (!tenant) return null;
  const s = tenantSettings(tenant);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const feedUrl = `${base}/api/ics/${tenant.ics_token}`;
  const prefs = await getPrefs("owner", session.email);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-semibold text-lg mb-1">Appearance</h2>
        <p className="text-sm text-gray-600 mb-3">Colors save instantly. Your dashboard theme is private to you; your booking page color is what customers see.</p>
        <div className="card card-pad space-y-6">
          <div>
            <p className="label">Your dashboard — just your view</p>
            <ThemePicker scope="owner" accent={prefs.accent} background={prefs.background} />
          </div>
          <div className="border-t border-[var(--border)] pt-5">
            <p className="label">Your booking page — what customers see</p>
            <BookingColorPicker current={tenant.branding.color ?? "#006778"} />
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-1">Customer options</h2>
        <p className="text-sm text-gray-600 mb-3">Turn optional features on or off. Changes show on your booking page right away — you decide what your customers see.</p>
        <FeatureToggle featureKey="sms_enabled" initial={s.smsEnabled} testid="toggle-sms"
          label="Text message updates"
          description="Let customers opt in to text confirmations and reminders when they book. When off, the text option is hidden from your booking page entirely." />
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-3">Booking rules</h2>
        <SettingsForm initial={{ cutoff_hours: s.cutoffHours, min_notice_hours: s.minNoticeHours, max_advance_days: s.maxAdvanceDays, granularity_min: s.granularityMin }} />
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-1">Automatic reminders</h2>
        <p className="text-sm text-gray-500 mb-3">We&apos;ll email each customer a reminder before their time — the easiest way to cut no-shows. Pick when.</p>
        <RemindersForm initial={s.reminderHours} />
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-1">Ask for reviews automatically</h2>
        <p className="text-sm text-gray-500 mb-3">More 5-star reviews, on autopilot. After each visit we&apos;ll invite the customer to review you — the single best way to win new local customers.</p>
        <ReviewRequestForm initial={{ enabled: s.reviewRequest.enabled, delayHours: s.reviewRequest.delayHours, url: s.reviewRequest.url, channel: s.reviewRequest.channel }} />
      </section>

      <section>
        <h2 className="font-semibold text-lg mb-1">See bookings in YOUR calendar</h2>
        <p className="text-sm text-gray-500 mb-3">Subscribe once and every booking shows up automatically in the calendar you already use — Google, Outlook, iPhone, or Yahoo.</p>
        <div className="card flex items-center gap-2 p-3">
          <code className="text-xs text-gray-600 truncate grow" data-testid="feed-url">{feedUrl}</code>
          <CopyButton text={feedUrl} />
        </div>
        <details className="mt-3 text-sm text-gray-600">
          <summary className="cursor-pointer font-medium">How to subscribe (Google / Outlook / iPhone / Yahoo)</summary>
          <ul className="mt-2 space-y-2 list-disc pl-5">
            <li><strong>Google Calendar:</strong> Settings → Add calendar → From URL → paste the link.</li>
            <li><strong>Outlook:</strong> Add calendar → Subscribe from web → paste the link.</li>
            <li><strong>iPhone / Apple:</strong> Settings → Calendar → Accounts → Add Subscribed Calendar → paste the link.</li>
            <li><strong>Yahoo Calendar:</strong> Actions → Follow Other Calendars → paste the link.</li>
          </ul>
          <p className="mt-2 text-xs text-gray-600">Tip: you also get an email with a calendar invite on every single booking — that lands in any calendar instantly.</p>
        </details>
        <div className="mt-3">
          <DashAction label="Reset feed URL (revokes the old link)" body={{ action: "reset_feed" }} confirmMsg="Reset your calendar feed URL? Anywhere the old link is subscribed will stop updating." testid="reset-feed" />
        </div>
      </section>
    </div>
  );
}
