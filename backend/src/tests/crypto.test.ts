import { describe, it, expect, beforeAll } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL ??= "redis://localhost:6379";
process.env.JWT_SECRET ??= "x".repeat(48);
process.env.WALLET_MASTER_KEY ??= "y".repeat(48);
process.env.BREVO_API_KEY ??= "test";
process.env.BREVO_SENDER_EMAIL ??= "test@example.com";

let cryptoLib: typeof import("../lib/crypto.js");
beforeAll(async () => {
  cryptoLib = await import("../lib/crypto.js");
});

describe("wallet key encryption", () => {
  it("round-trips a private key", () => {
    const pk = "0x" + "ab".repeat(32);
    const enc = cryptoLib.encryptPrivateKey(pk);
    expect(enc.ciphertext).not.toContain(pk);
    expect(cryptoLib.decryptPrivateKey(enc)).toBe(pk);
  });

  it("uses unique salts and IVs per encryption", () => {
    const pk = "0x" + "cd".repeat(32);
    const a = cryptoLib.encryptPrivateKey(pk);
    const b = cryptoLib.encryptPrivateKey(pk);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("fails on tampered ciphertext", () => {
    const enc = cryptoLib.encryptPrivateKey("0x" + "ef".repeat(32));
    const tampered = { ...enc, ciphertext: Buffer.from("tampered-data-here").toString("base64") };
    expect(() => cryptoLib.decryptPrivateKey(tampered)).toThrow();
  });

  it("hashes tokens stably", () => {
    expect(cryptoLib.sha256("abc")).toBe(cryptoLib.sha256("abc"));
    expect(cryptoLib.sha256("abc")).not.toBe(cryptoLib.sha256("abd"));
  });

  it("generates url-safe random tokens", () => {
    const t = cryptoLib.randomToken();
    expect(t.length).toBeGreaterThan(30);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
