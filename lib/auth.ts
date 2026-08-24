import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes, randomInt } from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";
import { envConfig, appMode } from "./env";
import { getServices } from "./services";
import { APP_NAME } from "./brand";

const COOKIE = "bh_session";
export const DEMO_CODE = "123456";

export type Session = { email: string; role: "owner" | "admin"; tenantId: string | null; impersonating?: boolean };

function secretKey(): Uint8Array {
  return new TextEncoder().encode(envConfig().appSecret);
}

export async function createSession(s: Session): Promise<void> {
  const jwt = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secretKey());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 7 * 86400 });
}

export async function getSession(): Promise<Session | null> {
  const c = (await cookies()).get(COOKIE);
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c.value, secretKey());
    return { email: payload.email as string, role: payload.role as Session["role"], tenantId: (payload.tenantId as string) ?? null, impersonating: payload.impersonating as boolean | undefined };
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${envConfig().appSecret}:${email.toLowerCase()}:${code}`).digest("hex");
}

export function newToken(): string {
  return randomBytes(16).toString("base64url"); // 128-bit
}

/** Issue a login code. Uniform behavior whether or not the email exists (resolution #4). */
export async function issueCode(emailRaw: string): Promise<void> {
  const email = emailRaw.trim().toLowerCase();
  const d = db();
  if (appMode() !== "demo") {
    // throttle: max 3 issuances per hour per email (prod; demo logins use the fixed code freely)
    const { count } = await d.from("bh_login_codes").select("id", { count: "exact", head: true })
      .eq("email", email).gt("created_at", new Date(Date.now() - 3600000).toISOString());
    if ((count ?? 0) >= 3) return; // silently accept — uniform response
  }

  const isSeededOwner = await emailIsKnown(email);
  if (!isSeededOwner) return; // uniform response; no code stored for unknown emails

  const code = appMode() === "demo" ? DEMO_CODE : String(randomInt(100000, 1000000));
  await d.from("bh_login_codes").insert({
    email, code_hash: hashCode(email, code),
    expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
  });
  if (appMode() !== "demo") {
    await getServices().mail.send({
      tenantId: null, to: email, subject: "Your login code",
      html: `<p>Your ${APP_NAME} login code is <strong style="font-size:20px">${code}</strong>. It expires in 10 minutes.</p>`,
    });
  }
}

async function emailIsKnown(email: string): Promise<boolean> {
  const cfg = envConfig();
  if (cfg.adminEmails.includes(email)) return true;
  const { data } = await db().from("bh_staff").select("id").eq("email", email).eq("active", true).limit(1);
  return (data?.length ?? 0) > 0;
}

/** Verify a code: single-use, ≤5 attempts, 10-min expiry. Returns session on success. */
export async function verifyCode(emailRaw: string, code: string): Promise<Session | null> {
  const email = emailRaw.trim().toLowerCase();
  const d = db();
  const { data: rows } = await d.from("bh_login_codes").select("*")
    .eq("email", email).gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  if (!row) return null;
  if (row.attempts >= 5) return null;
  if (row.code_hash !== hashCode(email, code)) {
    await d.from("bh_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
    return null;
  }
  await d.from("bh_login_codes").delete().eq("id", row.id); // single-use
  // cleanup stale codes opportunistically
  await d.from("bh_login_codes").delete().lt("expires_at", new Date().toISOString());

  const cfg = envConfig();
  if (cfg.adminEmails.includes(email)) return { email, role: "admin", tenantId: null };
  const { data: staff } = await d.from("bh_staff").select("id, tenant_id").eq("email", email).eq("active", true).limit(1);
  if (!staff?.length) return null;
  return { email, role: "owner", tenantId: staff[0].tenant_id };
}
