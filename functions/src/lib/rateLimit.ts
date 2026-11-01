import { HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, sha256 } from "./common";

export const WINDOW_MS = 15 * 60 * 1000;

export interface Limit {
  /** e.g. "pw:uid:abc" — hashed before storage. */
  key: string;
  maxFailures: number;
}

const ref = (key: string) => db().collection("rateLimits").doc(sha256(key));

/** Throws resource-exhausted if any key has too many recent failures. */
export async function assertNotLocked(limits: Limit[], now = Date.now()): Promise<void> {
  const snaps = await db().getAll(...limits.map((l) => ref(l.key)));
  snaps.forEach((snap, i) => {
    if (!snap.exists) return;
    const windowStart = snap.get("windowStart") as number;
    const count = snap.get("count") as number;
    if (now - windowStart < WINDOW_MS && count >= limits[i].maxFailures) {
      const minutes = Math.ceil((windowStart + WINDOW_MS - now) / 60000);
      throw new HttpsError(
        "resource-exhausted",
        `Too many tries. Please wait about ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      );
    }
  });
}

export async function recordFailure(limits: Limit[], now = Date.now()): Promise<void> {
  await Promise.all(
    limits.map((l) =>
      db().runTransaction(async (tx) => {
        const r = ref(l.key);
        const snap = await tx.get(r);
        const windowStart = snap.exists ? (snap.get("windowStart") as number) : 0;
        if (!snap.exists || now - windowStart >= WINDOW_MS) {
          tx.set(r, { count: 1, windowStart: now });
        } else {
          tx.update(r, { count: FieldValue.increment(1) });
        }
      }),
    ),
  );
}

export async function clearFailures(limits: Limit[]): Promise<void> {
  await Promise.all(limits.map((l) => ref(l.key).delete()));
}
