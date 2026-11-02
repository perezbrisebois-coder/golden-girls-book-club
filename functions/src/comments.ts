import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, requireAdmin, requireMember, str } from "./lib/common";

const comments = () => db().collection("comments");
const MAX_LENGTH = 2000;

/**
 * Member: post a comment, or a reply to one. Replies are one level deep: a
 * reply to a reply is attached to the top-level comment.
 */
export const postComment = onCall(async (req) => {
  const { memberId, name } = await requireMember(req);
  const text = str(req.data?.text, "your comment", { max: MAX_LENGTH, required: true });
  const replyTo = str(req.data?.parentId, "comment", { max: 128 });

  let parentId: string | null = null;
  if (replyTo) {
    const parent = await comments().doc(replyTo).get();
    if (!parent.exists) throw new HttpsError("not-found", "That comment was deleted.");
    parentId = (parent.get("parentId") as string | null) ?? parent.id;
  }

  const ref = comments().doc();
  await ref.create({
    authorId: memberId,
    authorName: name,
    text,
    parentId,
    pinned: false,
    createdAt: FieldValue.serverTimestamp(),
    editedAt: null,
  });
  return { id: ref.id };
});

/** Member: edit their own comment. Shows an "edited" label. */
export const editComment = onCall(async (req) => {
  const { memberId } = await requireMember(req);
  const id = str(req.data?.id, "comment", { max: 128, required: true });
  const text = str(req.data?.text, "your comment", { max: MAX_LENGTH, required: true });
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(comments().doc(id));
    if (!snap.exists) throw new HttpsError("not-found", "That comment was deleted.");
    if (snap.get("authorId") !== memberId) throw new HttpsError("permission-denied", "You can only edit your own comments.");
    if (snap.get("text") === text) return;
    tx.update(snap.ref, { text, editedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/** Member: delete their own comment. Admin: delete any. Deleting a comment also deletes its replies. */
export const deleteComment = onCall(async (req) => {
  const { memberId, role } = await requireMember(req);
  const id = str(req.data?.id, "comment", { max: 128, required: true });
  const snap = await comments().doc(id).get();
  if (!snap.exists) return { ok: true };
  if (snap.get("authorId") !== memberId && role !== "admin") {
    throw new HttpsError("permission-denied", "You can only delete your own comments.");
  }
  const replies = await comments().where("parentId", "==", id).get();
  const batch = db().batch();
  replies.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(snap.ref);
  await batch.commit();
  return { ok: true };
});

/** Admin: pin a top-level comment to the top of the board, or unpin it. */
export const pinComment = onCall(async (req) => {
  requireAdmin(req);
  const id = str(req.data?.id, "comment", { max: 128, required: true });
  const pinned = req.data?.pinned === true;
  const snap = await comments().doc(id).get();
  if (!snap.exists) throw new HttpsError("not-found", "That comment was deleted.");
  if (snap.get("parentId")) throw new HttpsError("invalid-argument", "Only top-level comments can be pinned.");
  await snap.ref.update({ pinned });
  return { ok: true };
});
