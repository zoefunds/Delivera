/** Small crypto helpers for session/nonce tokens — unrelated to any wallet
 * key material (there is no custodial wallet to encrypt anymore; every
 * GenLayer write is signed by the user themselves in the browser). */
import crypto from "node:crypto";

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
