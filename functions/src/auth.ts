import { onCall, HttpsError } from "firebase-functions/https";
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { ADMIN_PASSWORD, MEMBER_PASSWORD } from "./lib/secrets";
import { clientIp, db, nameKey, requireAdmin, requireRole, str, type Role } from "./lib/common";
import { hashPin, isValidPin, safeEqual, verifyPin } from "./lib/pin";
import { assertNotLocked, clearFailures, recordFailure, type Limit } from "./lib/rateLimit";

/** Step 1: shared password -> marks this (anonymous) session as member or admin. */
export const enterPassword = onCall(
  { secrets: [MEMBER_PASSWORD, ADMIN_PASSWORD] },
  async (req): Promise<{ role: Role }> => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Please reload the page and try again.");
    const password = typeof req.data?.password === "string" ? req.data.password.trim() : "";
    if (!password) throw new HttpsError("invalid-argument", "Please enter the club password.");

    const limits: Limit[] = [
      { key: `pw:uid:${uid}`, maxFailures: 5 },
      { key: `pw:ip:${clientIp(req)}`, maxFailures: 20 },
    ];
    await assertNotLocked(limits);

    let role: Role | null = null;
    if (safeEqual(password, ADMIN_PASSWORD.value())) role = "admin";
    else if (safeEqual(password, MEMBER_PASSWORD.value())) role = "member";

    if (!role) {
      await recordFailure(limits);
      throw new HttpsError("permission-denied", "That password isn't right. Please check with the club and try again.");
    }
    await clearFailures(limits.slice(0, 1));
    // Keep any member identity already on this device.
    const existing = (await getAuth().getUser(uid)).customClaims ?? {};
    await getAuth().setCustomUserClaims(uid, { ...existing, role });
    return { role };
  },
);

type IdentifyResult =
  | { status: "notFound" }
  | { status: "signedIn" | "created" | "pinReset"; memberId: string; name: string };

/**
 * Step 2: name + PIN.
 * - Existing member with a PIN: PIN must match.
 * - Existing member whose PIN the admin cleared: this PIN becomes their new PIN.
 * - Unknown name: returns notFound unless createIfNew is true (lets the UI ask
 *   "Are you new?" instead of silently creating a duplicate from a typo).
 */
export const identifyMember = onCall(async (req): Promise<IdentifyResult> => {
  const role = requireRole(req);
  const uid = req.auth!.uid;
  const name = str(req.data?.name, "your name", { max: 40, required: true }).replace(/\s+/g, " ");
  const pin = req.data?.pin;
  if (!isValidPin(pin)) throw new HttpsError("invalid-argument", "Your PIN must be exactly 4 digits.");
  const createIfNew = req.data?.createIfNew === true;
  const key = nameKey(name);

  const baseLimits: Limit[] = [
    { key: `pin:uid:${uid}`, maxFailures: 5 },
    { key: `pin:ip:${clientIp(req)}`, maxFailures: 20 },
  ];
  const members = db().collection("members");
  const found = await members.where("nameKey", "==", key).limit(1).get();
  const memberLimit: Limit[] = found.empty ? [] : [{ key: `pin:member:${found.docs[0].id}`, maxFailures: 5 }];
  const limits = [...baseLimits, ...memberLimit];
  await assertNotLocked(limits);

  const result = await db().runTransaction(async (tx): Promise<IdentifyResult | "badPin"> => {
    const q = await tx.get(members.where("nameKey", "==", key).limit(1));
    if (q.empty) {
      if (!createIfNew) return { status: "notFound" };
      const ref = members.doc();
      tx.create(ref, { name, nameKey: key, hasPin: true, createdAt: FieldValue.serverTimestamp() });
      tx.create(db().collection("memberSecrets").doc(ref.id), hashPin(pin));
      return { status: "created", memberId: ref.id, name };
    }
    const memberDoc = q.docs[0];
    const secretRef = db().collection("memberSecrets").doc(memberDoc.id);
    const secret = await tx.get(secretRef);
    const memberName = memberDoc.get("name") as string;
    if (!secret.exists || !secret.get("pinHash")) {
      tx.set(secretRef, hashPin(pin));
      tx.update(memberDoc.ref, { hasPin: true });
      return { status: "pinReset", memberId: memberDoc.id, name: memberName };
    }
    if (!verifyPin(pin, secret.get("pinHash"), secret.get("salt"))) return "badPin";
    return { status: "signedIn", memberId: memberDoc.id, name: memberName };
  });

  if (result === "badPin") {
    await recordFailure(limits);
    throw new HttpsError(
      "permission-denied",
      "That PIN doesn't match. If you've forgotten it, ask the club admin to clear it.",
    );
  }
  if (result.status === "notFound") return result;

  await clearFailures(limits.filter((l) => !l.key.startsWith("pin:ip:")));
  await getAuth().setCustomUserClaims(uid, { role, memberId: result.memberId });
  return result;
});

/** "Not you?" — forget the member identity on this device but keep the password session. */
export const switchMember = onCall(async (req) => {
  const role = requireRole(req);
  await getAuth().setCustomUserClaims(req.auth!.uid, { role });
  return { ok: true };
});

/** Admin: clear (never view) a member's PIN so they can set a new one. */
export const adminClearPin = onCall(async (req) => {
  requireAdmin(req);
  const memberId = str(req.data?.memberId, "member", { max: 128, required: true });
  const memberRef = db().collection("members").doc(memberId);
  if (!(await memberRef.get()).exists) throw new HttpsError("not-found", "That member no longer exists.");
  const batch = db().batch();
  batch.delete(db().collection("memberSecrets").doc(memberId));
  batch.update(memberRef, { hasPin: false });
  await batch.commit();
  return { ok: true };
});

/**
 * Admin: remove a member. Their profile, PIN and date-poll selections are
 * deleted. Comments and proposals keep the name they were posted under.
 */
export const adminRemoveMember = onCall(async (req) => {
  requireAdmin(req);
  const memberId = str(req.data?.memberId, "member", { max: 128, required: true });
  const batch = db().batch();
  batch.delete(db().collection("members").doc(memberId));
  batch.delete(db().collection("memberSecrets").doc(memberId));
  const availability = await db().collectionGroup("availability").where("memberId", "==", memberId).get();
  availability.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { ok: true };
});
