// App-layer envelope encryption for third-party tokens (R1).
// AES-256-GCM with a key derived from APP_SECRET via scrypt. The DB only ever stores
// ciphertext; APP_SECRET lives in env and never in the database, so an app-key holder
// or a DB dump cannot use the stored OAuth tokens.
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "crypto";

let _key: Buffer | null = null;
function key(): Buffer {
  if (_key) return _key;
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is required to encrypt/decrypt tokens");
  // Static salt is fine here: the secret is high-entropy and per-deployment.
  _key = scryptSync(secret, "slotter.token.v1", 32);
  return _key;
}

/** Returns base64("v1" | iv(12) | tag(16) | ciphertext), or null for null/empty input. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([Buffer.from("v1"), iv, tag, ct]).toString("base64");
}

/** Inverse of encryptSecret. Returns null for null input; throws on tampering. */
export function decryptSecret(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const raw = Buffer.from(enc, "base64");
  const ver = raw.subarray(0, 2).toString();
  if (ver !== "v1") throw new Error(`unknown token cipher version: ${ver}`);
  const iv = raw.subarray(2, 14);
  const tag = raw.subarray(14, 30);
  const ct = raw.subarray(30);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
