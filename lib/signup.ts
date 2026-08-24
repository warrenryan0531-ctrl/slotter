// Market signup with email verification (H1). The business is NOT created until the owner
// proves control of the email by entering the code, closing the email-squatting hole.
import { randomInt } from "crypto";
import { db } from "./db";
import { appMode } from "./env";
import { DEMO_CODE, hashCode, createSession } from "./auth";
import { getServices } from "./services";
import { APP_NAME } from "./brand";

export type PendingBusiness = { businessName: string; slug: string; tz: string; ownerName: string };

export function normalizeSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Slug is free if no tenant uses it and no un-expired pending signup holds it. */
async function slugAvailable(slug: string): Promise<boolean> {
  const d = db();
  const { data: t } = await d.from("bh_tenants").select("id").eq("slug", slug).limit(1);
  if (t?.length) return false;
  const { data: p } = await d.from("bh_signup_pending").select("email, business, expires_at");
  const held = (p ?? []).some((r: { business: { slug?: string }; expires_at: string }) =>
    r.business?.slug === slug && Date.parse(r.expires_at) > Date.now());
  return !held;
}

export type StartResult = { ok: true } | { ok: false; error: "slug_taken" | "invalid" };

/** Step 1: park the pending business + issue a code. No tenant is created yet. */
export async function startSignup(input: { businessName: string; slug: string; tz?: string; ownerName?: string; ownerEmail: string }): Promise<StartResult> {
  const email = input.ownerEmail.trim().toLowerCase();
  const slug = normalizeSlug(input.slug);
  const name = input.businessName.trim();
  if (!name || !slug || !email) return { ok: false, error: "invalid" };
  if (!(await slugAvailable(slug))) return { ok: false, error: "slug_taken" };

  const code = appMode() === "demo" ? DEMO_CODE : String(randomInt(100000, 1000000));
  const business: PendingBusiness = { businessName: name, slug, tz: input.tz || "America/New_York", ownerName: input.ownerName || "Owner" };
  await db().from("bh_signup_pending").upsert({
    email, business, code_hash: hashCode(email, code), attempts: 0,
    expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
  });
  if (appMode() !== "demo") {
    await getServices().mail.send({
      tenantId: null, to: email, subject: `Confirm your ${APP_NAME} account`,
      html: `<p>Your ${APP_NAME} verification code is <strong style="font-size:20px">${code}</strong>. It expires in 30 minutes.</p>`,
    });
  }
  return { ok: true };
}

export type VerifyResult = { ok: true; tenantId: string; slug: string } | { ok: false; error: "bad_code" | "expired" | "no_pending" };

/** Step 2: verify the code, THEN create the tenant + owner, sign the owner in. */
export async function verifySignup(emailRaw: string, code: string): Promise<VerifyResult> {
  const email = emailRaw.trim().toLowerCase();
  const d = db();
  const { data: rows } = await d.from("bh_signup_pending").select("*").eq("email", email).limit(1);
  const row = rows?.[0] as { email: string; business: PendingBusiness; code_hash: string; attempts: number; expires_at: string } | undefined;
  if (!row) return { ok: false, error: "no_pending" };
  if (Date.parse(row.expires_at) < Date.now()) { await d.from("bh_signup_pending").delete().eq("email", email); return { ok: false, error: "expired" }; }
  if (row.attempts >= 5) return { ok: false, error: "bad_code" };
  if (row.code_hash !== hashCode(email, code)) {
    await d.from("bh_signup_pending").update({ attempts: row.attempts + 1 }).eq("email", email);
    return { ok: false, error: "bad_code" };
  }
  // Code good — create the business now, then drop the pending row (single-use).
  const { data, error } = await d.rpc("bh_create_tenant", {
    p_slug: row.business.slug, p_name: row.business.businessName, p_tz: row.business.tz,
    p_owner_name: row.business.ownerName, p_owner_email: email,
  });
  if (error) {
    // A race took the slug between start and verify.
    if (error.message.includes("duplicate")) return { ok: false, error: "no_pending" };
    throw new Error(`signup tenant create failed: ${error.message}`);
  }
  await d.from("bh_signup_pending").delete().eq("email", email);
  await createSession({ email, role: "owner", tenantId: data as string });
  return { ok: true, tenantId: data as string, slug: row.business.slug };
}
