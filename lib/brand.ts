// Central branding for the open-source build. Override via env — no code changes needed to rebrand.
// - NEXT_PUBLIC_APP_NAME    the product name shown in UI + emails (default "Slotter")
// - APP_ICS_DOMAIN          domain used for calendar UIDs and the organizer address (default "slotter.local")
// - NEXT_PUBLIC_HIDE_ATTRIBUTION="true" hides the small "scheduling by <app>" footer line
export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Slotter";
export const ICS_DOMAIN = process.env.APP_ICS_DOMAIN || "slotter.local";
export const ORGANIZER_EMAIL = `bookings@${ICS_DOMAIN}`;
export const SHOW_ATTRIBUTION = process.env.NEXT_PUBLIC_HIDE_ATTRIBUTION !== "true";
