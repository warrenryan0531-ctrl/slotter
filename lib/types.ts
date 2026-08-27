export type Tenant = {
  id: string; slug: string; name: string; tz: string;
  branding: { color?: string; accent?: string; logo_url?: string; intro?: string; phone?: string };
  settings: { cutoff_hours?: number; min_notice_hours?: number; max_advance_days?: number; granularity_min?: number };
  ics_token: string;
};

export type Staff = { id: string; tenant_id: string; name: string; email: string | null; is_owner: boolean; active: boolean };

export type Service = {
  id: string; tenant_id: string; name: string; description: string | null;
  duration_min: number; buffer_before_min: number; buffer_after_min: number;
  price_cents: number | null; kind: "call" | "appointment" | "onsite";
  location_mode: "phone" | "address" | "business" | "video"; active: boolean; sort: number;
  booking_mode: "instant" | "request";
  capacity: number; is_group: boolean;
  requires_payment: boolean; deposit_cents: number | null;
  pay_mode?: "deposit" | "full";
  // B3: no-show / late-cancel fee protection.
  protect_no_show?: boolean;
  no_show_fee_cents?: number | null;
  fee_model?: "flat" | "percent";
};

export type BookingEvent = {
  id: string; tenant_id: string; service_id: string; staff_id: string;
  starts_at: string; ends_at: string; capacity: number; active: boolean;
};

export type IntakeQuestion = {
  id: string; service_id: string; label: string;
  type: "text" | "textarea" | "select" | "phone" | "address" | "file";
  options: string[] | null; required: boolean; sort: number;
};

export type AvailabilityRule = { id: string; staff_id: string; weekday: number; start_min: number; end_min: number };
export type AvailabilityOverride = { id: string; staff_id: string; date: string; closed: boolean; start_min: number | null; end_min: number | null };
export type Block = { id: string; staff_id: string; starts_at: string; ends_at: string; reason: string | null };

export type Booking = {
  id: string; tenant_id: string; service_id: string; staff_id: string;
  customer: { name: string; phone: string; email: string };
  intake_answers: Record<string, string>;
  address: { line: string } | null;
  starts_at: string; ends_at: string;
  buffer_before_min: number; buffer_after_min: number;
  status: "pending" | "confirmed" | "cancelled" | "declined";
  sms_consent: boolean; manage_token: string; ics_uid: string; ics_sequence: number;
  payment_status: "none" | "awaiting" | "paid" | "refunded"; deposit_cents: number | null;
  event_id?: string | null;
  no_show?: boolean;
  checkout_ref?: string | null;
  meeting_url?: string | null; // B1: provider video-call join link (Meet/Teams)
  // B3: vaulted card on the tenant's Stripe + one-time fee marker (null = not charged).
  stripe_customer_id?: string | null;
  stripe_payment_method_id?: string | null;
  fee_charged_cents?: number | null;
  fee_quote_cents?: number | null; // B3: fee amount disclosed at booking — charge this exact value
  fee_charge_pending?: boolean; // B3: a charge was attempted; reconcile before charging again
  created_at: string;
};

export type ReviewChannel = "email" | "sms" | "both";
export type ReviewRequestSettings = { enabled: boolean; delayHours: number; url: string; channel: ReviewChannel };

export function tenantSettings(t: Tenant) {
  const s = t.settings as {
    reminder_hours?: number[]; sms_enabled?: boolean; cancel_window_hours?: number;
    review_enabled?: boolean; review_delay_hours?: number; review_url?: string; review_channel?: ReviewChannel;
  };
  const rh = s.reminder_hours;
  const reviewChannel: ReviewChannel = s.review_channel === "sms" || s.review_channel === "both" ? s.review_channel : "email";
  return {
    cutoffHours: t.settings.cutoff_hours ?? 24,
    minNoticeHours: t.settings.min_notice_hours ?? 4,
    maxAdvanceDays: t.settings.max_advance_days ?? 30,
    granularityMin: t.settings.granularity_min ?? 30,
    // Reminder offsets in hours before start. Default: a day-before nudge.
    reminderHours: Array.isArray(rh) && rh.length ? rh.filter((h) => h > 0).slice(0, 4) : [24],
    // SMS on by default (still gated by per-booking consent + a configured provider).
    smsEnabled: s.sms_enabled !== false,
    // E4: hours before start within which the customer can no longer self-cancel/reschedule.
    cancelWindowHours: s.cancel_window_hours ?? 0,
    // B2: post-visit review-request automation. Off unless enabled AND a review URL is set.
    reviewRequest: {
      enabled: s.review_enabled === true && typeof s.review_url === "string" && s.review_url.length > 0,
      delayHours: typeof s.review_delay_hours === "number" && s.review_delay_hours > 0 ? s.review_delay_hours : 3,
      url: typeof s.review_url === "string" ? s.review_url : "",
      channel: reviewChannel,
    } as ReviewRequestSettings,
  };
}
