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
  location_mode: "phone" | "address" | "business"; active: boolean; sort: number;
  booking_mode: "instant" | "request";
  capacity: number; is_group: boolean;
  requires_payment: boolean; deposit_cents: number | null;
  pay_mode?: "deposit" | "full";
};

export type BookingEvent = {
  id: string; tenant_id: string; service_id: string; staff_id: string;
  starts_at: string; ends_at: string; capacity: number; active: boolean;
};

export type IntakeQuestion = {
  id: string; service_id: string; label: string;
  type: "text" | "textarea" | "select" | "phone" | "address";
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
  created_at: string;
};

export function tenantSettings(t: Tenant) {
  const s = t.settings as {
    reminder_hours?: number[]; sms_enabled?: boolean; cancel_window_hours?: number;
  };
  const rh = s.reminder_hours;
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
  };
}
