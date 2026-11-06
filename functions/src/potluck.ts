import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, isoDate, requireAdmin, requireMember, str } from "./lib/common";

const potlucks = () => db().collection("potlucks");

export const CATEGORIES = ["Appetizer", "Main dish", "Side", "Salad", "Dessert", "Drinks", "Supplies", "Other"] as const;
const MAX_ITEMS_PER_MEMBER = 5;

function category(value: unknown): string {
  const c = str(value, "the type of dish", { max: 40, required: true });
  if (!(CATEGORIES as readonly string[]).includes(c)) throw new HttpsError("invalid-argument", "Please choose a type of dish.");
  return c;
}

/** Admin: start a potluck sign-up for a meeting date. */
export const openPotluck = onCall(async (req) => {
  requireAdmin(req);
  const date = isoDate(req.data?.date, "the meeting date", true);
  const notes = str(req.data?.notes, "the notes", { max: 1000 });
  const existing = await potlucks().where("date", "==", date).limit(1).get();
  if (!existing.empty) throw new HttpsError("already-exists", "There's already a potluck for that date.");
  const ref = potlucks().doc();
  await ref.create({ date, notes, status: "open", createdAt: FieldValue.serverTimestamp() });
  return { id: ref.id };
});

/** Admin: change the notes, or close/reopen sign-ups. */
export const updatePotluck = onCall(async (req) => {
  requireAdmin(req);
  const id = str(req.data?.id, "potluck", { max: 128, required: true });
  const ref = potlucks().doc(id);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "That potluck no longer exists.");
  const update: Record<string, unknown> = {};
  if (req.data?.notes !== undefined) update.notes = str(req.data.notes, "the notes", { max: 1000 });
  if (req.data?.status !== undefined) {
    if (req.data.status !== "open" && req.data.status !== "closed") throw new HttpsError("invalid-argument", "Invalid status.");
    update.status = req.data.status;
  }
  await ref.update(update);
  return { ok: true };
});

/** Admin: delete a potluck and everything signed up for it. */
export const deletePotluck = onCall(async (req) => {
  requireAdmin(req);
  const id = str(req.data?.id, "potluck", { max: 128, required: true });
  const ref = potlucks().doc(id);
  const items = await ref.collection("items").get();
  const batch = db().batch();
  items.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(ref);
  await batch.commit();
  return { ok: true };
});

/** Member: sign up to bring something. The member comes from the signed-in session. */
export const addPotluckItem = onCall(async (req) => {
  const { memberId, name } = await requireMember(req);
  const potluckId = str(req.data?.potluckId, "potluck", { max: 128, required: true });
  const dish = str(req.data?.dish, "what you're bringing", { max: 120, required: true });
  const cat = category(req.data?.category);
  const note = str(req.data?.note, "the note", { max: 300 });

  const potluck = potlucks().doc(potluckId);
  const ref = potluck.collection("items").doc();
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(potluck);
    if (!snap.exists) throw new HttpsError("not-found", "That potluck no longer exists.");
    if (snap.get("status") !== "open") throw new HttpsError("failed-precondition", "Sign-ups for this potluck are closed.");
    const mine = await tx.get(potluck.collection("items").where("memberId", "==", memberId));
    if (mine.size >= MAX_ITEMS_PER_MEMBER) {
      throw new HttpsError("resource-exhausted", `You can list up to ${MAX_ITEMS_PER_MEMBER} things per potluck.`);
    }
    tx.create(ref, { memberId, name, dish, category: cat, note, createdAt: FieldValue.serverTimestamp() });
  });
  return { id: ref.id };
});

/** Member: change their own item while sign-ups are open. */
export const editPotluckItem = onCall(async (req) => {
  const { memberId } = await requireMember(req);
  const potluckId = str(req.data?.potluckId, "potluck", { max: 128, required: true });
  const id = str(req.data?.id, "item", { max: 128, required: true });
  const dish = str(req.data?.dish, "what you're bringing", { max: 120, required: true });
  const cat = category(req.data?.category);
  const note = str(req.data?.note, "the note", { max: 300 });
  const potluck = potlucks().doc(potluckId);
  await db().runTransaction(async (tx) => {
    const [p, item] = await Promise.all([tx.get(potluck), tx.get(potluck.collection("items").doc(id))]);
    if (!p.exists || !item.exists) throw new HttpsError("not-found", "That item no longer exists.");
    if (item.get("memberId") !== memberId) throw new HttpsError("permission-denied", "You can only change what you signed up for.");
    if (p.get("status") !== "open") throw new HttpsError("failed-precondition", "Sign-ups for this potluck are closed.");
    tx.update(item.ref, { dish, category: cat, note, updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/** Member: remove their own item. Admin: remove any. */
export const deletePotluckItem = onCall(async (req) => {
  const { memberId, role } = await requireMember(req);
  const potluckId = str(req.data?.potluckId, "potluck", { max: 128, required: true });
  const id = str(req.data?.id, "item", { max: 128, required: true });
  const ref = potlucks().doc(potluckId).collection("items").doc(id);
  const item = await ref.get();
  if (!item.exists) return { ok: true };
  if (item.get("memberId") !== memberId && role !== "admin") {
    throw new HttpsError("permission-denied", "You can only remove what you signed up for.");
  }
  await ref.delete();
  return { ok: true };
});
