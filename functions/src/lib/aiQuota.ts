import { HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./common";

/** Max AI lookups per member per day, to keep API costs predictable. */
export const DAILY_AI_LIMIT = 25;

/** Counts one AI call for this member today; throws once the daily limit is reached. */
export async function useAiQuota(memberId: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const ref = db().collection("rateLimits").doc(`ai-${memberId}-${day}`);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const count = snap.exists ? (snap.get("count") as number) : 0;
    if (count >= DAILY_AI_LIMIT) {
      throw new HttpsError("resource-exhausted", "You've done a lot of lookups today. Please try again tomorrow.");
    }
    tx.set(ref, { count: FieldValue.increment(1), day }, { merge: true });
  });
}
