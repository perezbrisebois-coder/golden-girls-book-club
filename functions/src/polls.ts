import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, isoDate, requireAdmin, requireMember, str, time24 } from "./lib/common";
import { meetingRef } from "./meeting";

const polls = () => db().collection("polls");

/** All YYYY-MM-DD dates in a YYYY-MM month. */
export function datesInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** Dates members may choose from: the admin's candidate list, or the whole month. */
export function allowedDates(poll: { month: string; candidateDates?: string[] }): string[] {
  return poll.candidateDates && poll.candidateDates.length > 0 ? poll.candidateDates : datesInMonth(poll.month);
}

/** Admin: open a poll for a month, optionally limited to candidate dates. Only one poll can be open. */
export const openPoll = onCall(async (req) => {
  requireAdmin(req);
  const month = str(req.data?.month, "the month", { max: 7, required: true });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpsError("invalid-argument", "Please pick a valid month.");
  const raw: unknown[] = Array.isArray(req.data?.candidateDates) ? req.data.candidateDates : [];
  const monthDates = new Set(datesInMonth(month));
  const candidateDates = [...new Set(raw.map((d) => isoDate(d, "a candidate date", true)))].sort();
  if (candidateDates.some((d) => !monthDates.has(d))) {
    throw new HttpsError("invalid-argument", "All candidate dates must be in the chosen month.");
  }
  const note = str(req.data?.note, "the note", { max: 500 });

  const ref = polls().doc();
  await db().runTransaction(async (tx) => {
    const open = await tx.get(polls().where("status", "==", "open").limit(1));
    if (!open.empty) {
      throw new HttpsError("failed-precondition", "There's already an open date poll. Close it before starting a new one.");
    }
    tx.create(ref, {
      month,
      candidateDates,
      note,
      status: "open",
      finalDate: "",
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { pollId: ref.id };
});

/**
 * Member: save the dates *they* can attend. The member is taken from the
 * signed-in session (set by name + PIN), so nobody can change someone else's
 * selections. An empty list means "none of these dates work for me".
 */
export const setAvailability = onCall(async (req) => {
  const { memberId, name } = await requireMember(req);
  const pollId = str(req.data?.pollId, "poll", { max: 128, required: true });
  const raw: unknown[] = Array.isArray(req.data?.dates) ? req.data.dates : [];
  if (raw.length > 31) throw new HttpsError("invalid-argument", "Too many dates.");
  const dates = [...new Set(raw.map((d) => isoDate(d, "a date", true)))].sort();

  await db().runTransaction(async (tx) => {
    const poll = await tx.get(polls().doc(pollId));
    if (!poll.exists) throw new HttpsError("not-found", "That date poll no longer exists.");
    if (poll.get("status") !== "open") throw new HttpsError("failed-precondition", "This date poll is closed.");
    const allowed = new Set(allowedDates(poll.data() as { month: string; candidateDates?: string[] }));
    if (dates.some((d) => !allowed.has(d))) {
      throw new HttpsError("invalid-argument", "One of those dates isn't part of this poll.");
    }
    tx.set(poll.ref.collection("availability").doc(memberId), {
      memberId,
      name,
      dates,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

/** Admin: close the poll and (optionally) set the final date, which updates Meeting Info. */
export const closePoll = onCall(async (req) => {
  requireAdmin(req);
  const pollId = str(req.data?.pollId, "poll", { max: 128, required: true });
  const finalDate = isoDate(req.data?.finalDate, "the final date");
  const time = time24(req.data?.time, "the meeting time");

  await db().runTransaction(async (tx) => {
    const poll = await tx.get(polls().doc(pollId));
    if (!poll.exists) throw new HttpsError("not-found", "That date poll no longer exists.");
    if (finalDate && !allowedDates(poll.data() as { month: string; candidateDates?: string[] }).includes(finalDate)) {
      throw new HttpsError("invalid-argument", "The final date must be one of the poll's dates.");
    }
    tx.update(poll.ref, { status: "closed", finalDate, closedAt: FieldValue.serverTimestamp() });
    if (finalDate) {
      tx.set(
        meetingRef(),
        { date: finalDate, ...(time ? { time } : {}), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    }
  });
  return { ok: true };
});

/** Admin: reopen a closed poll (e.g. closed by mistake). Meeting Info is left as is. */
export const reopenPoll = onCall(async (req) => {
  requireAdmin(req);
  const pollId = str(req.data?.pollId, "poll", { max: 128, required: true });
  await db().runTransaction(async (tx) => {
    const poll = await tx.get(polls().doc(pollId));
    if (!poll.exists) throw new HttpsError("not-found", "That date poll no longer exists.");
    const open = await tx.get(polls().where("status", "==", "open").limit(1));
    if (!open.empty && open.docs[0].id !== pollId) {
      throw new HttpsError("failed-precondition", "Another date poll is open. Close it first.");
    }
    tx.update(poll.ref, { status: "open", finalDate: "" });
  });
  return { ok: true };
});
