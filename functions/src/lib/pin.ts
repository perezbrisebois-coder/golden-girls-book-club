import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

export function hashPin(pin: string): { pinHash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const pinHash = scryptSync(pin, salt, KEYLEN).toString("hex");
  return { pinHash, salt };
}

export function verifyPin(pin: string, pinHash: string, salt: string): boolean {
  const candidate = scryptSync(pin, salt, KEYLEN);
  const stored = Buffer.from(pinHash, "hex");
  return stored.length === candidate.length && timingSafeEqual(stored, candidate);
}

/** Constant-time string comparison (via fixed-length digests). */
export function safeEqual(a: string, b: string): boolean {
  const da = scryptSync(a, "pw", KEYLEN);
  const dbuf = scryptSync(b, "pw", KEYLEN);
  return timingSafeEqual(da, dbuf);
}
