import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => { process.env.APP_SECRET = "test-secret-do-not-use-in-prod-0123456789"; });

// Imported after env is set so the derived key uses the test secret.
const { encryptSecret, decryptSecret } = await import("../../lib/crypto");

describe("token envelope encryption (R1)", () => {
  it("round-trips a token", () => {
    const token = "ya29.a0AfrefreshTOKEN-value_with.dots-and_dashes";
    const enc = encryptSecret(token)!;
    expect(enc).not.toContain(token);          // ciphertext, not plaintext
    expect(decryptSecret(enc)).toBe(token);
  });

  it("passes through null/empty", () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret("")).toBeNull();
    expect(decryptSecret(null)).toBeNull();
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects tampered ciphertext", () => {
    const enc = encryptSecret("secret")!;
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] ^= 0xff;               // flip a ciphertext bit
    expect(() => decryptSecret(raw.toString("base64"))).toThrow();
  });
});
