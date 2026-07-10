/**
 * Custodial wallet key encryption.
 *
 * Each user's private key is encrypted with AES-256-GCM using a per-user data
 * key derived via scrypt from WALLET_MASTER_KEY + a random per-user salt.
 * Ciphertext, salt, IV and auth tag are stored in Postgres, so the wallet
 * survives device changes, cache clears and reinstalls.
 */
import crypto from "node:crypto";
import { config } from "../config.js";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(config.WALLET_MASTER_KEY, salt, 32, SCRYPT_PARAMS);
}

export interface EncryptedKey {
  ciphertext: string;
  salt: string;
  iv: string;
  authTag: string;
}

export function encryptPrivateKey(privateKey: string): EncryptedKey {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptPrivateKey(enc: EncryptedKey): string {
  const key = deriveKey(Buffer.from(enc.salt, "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
  decipher.setAuthTag(Buffer.from(enc.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(enc.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
