import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, isoDate, optionalUrl, requireAdmin, str, time24 } from "./lib/common";
import { bookKey } from "./lib/bookSources";

export interface BookInfo {
  key: string;
  title: string;
  authors: string[];
  coverUrl: string;
  description: string;
  year: string;
}

export const meetingRef = () => db().collection("config").doc("meeting");

/** IDs of every book chosen for the next meeting or a past meeting. */
export async function booksChosenForMeetings(): Promise<Set<string>> {
  const [meeting, past] = await Promise.all([meetingRef().get(), db().collection("pastMeetings").get()]);
  const keys = new Set<string>();
  for (const book of [meeting.get("book"), ...past.docs.map((d) => d.get("book"))]) {
    if (book?.title) keys.add(bookKey(book.title, book.authors ?? []));
  }
  return keys;
}

export function parseBook(raw: unknown): BookInfo | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") throw new HttpsError("invalid-argument", "Book details are invalid.");
  const b = raw as Record<string, unknown>;
  const title = str(b.title, "the book title", { max: 300 });
  if (!title) return null;
  const authors = Array.isArray(b.authors)
    ? b.authors.slice(0, 10).map((a) => str(a, "author", { max: 200 })).filter(Boolean)
    : [];
  return {
    // Same ID as the recommendation list uses, so a book chosen for a meeting
    // (picked from the list or typed in) can be left off future votes.
    key: bookKey(title, authors),
    title,
    authors,
    coverUrl: optionalUrl(b.coverUrl, "cover image address"),
    description: str(b.description, "book description", { max: 5000 }),
    year: str(b.year, "year", { max: 10 }),
  };
}

/** Admin: set the next meeting's details. */
export const updateMeeting = onCall(async (req) => {
  requireAdmin(req);
  const d = req.data ?? {};
  const meeting = {
    date: isoDate(d.date, "the meeting date"),
    time: time24(d.time, "the meeting time"),
    locationName: str(d.locationName, "the place name", { max: 200 }),
    address: str(d.address, "the address", { max: 500 }),
    mapUrl: optionalUrl(d.mapUrl, "the map link"),
    notes: str(d.notes, "notes", { max: 2000 }),
    book: parseBook(d.book),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await meetingRef().set(meeting, { merge: true });
  return { ok: true };
});

/**
 * Admin: move the current meeting into Past Meetings and clear the date and
 * book so the next one can be planned. Location is kept (clubs often reuse it).
 */
export const archiveMeeting = onCall(async (req) => {
  requireAdmin(req);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(meetingRef());
    if (!snap.exists || !snap.get("date")) {
      throw new HttpsError("failed-precondition", "There's no meeting date to archive yet.");
    }
    const m = snap.data()!;
    tx.create(db().collection("pastMeetings").doc(), {
      date: m.date,
      time: m.time ?? "",
      locationName: m.locationName ?? "",
      address: m.address ?? "",
      book: m.book ?? null,
      archivedAt: FieldValue.serverTimestamp(),
    });
    tx.update(meetingRef(), { date: "", time: "", book: null, notes: "", updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/** Admin: record a meeting that already happened (e.g. one held before the app existed). */
export const addPastMeeting = onCall(async (req) => {
  requireAdmin(req);
  const d = req.data ?? {};
  const date = isoDate(d.date, "the meeting date", true);
  if (date > new Date().toISOString().slice(0, 10)) {
    throw new HttpsError("invalid-argument", "That date is in the future. Use Edit meeting details for the next meeting.");
  }
  const ref = db().collection("pastMeetings").doc();
  await ref.create({
    date,
    time: time24(d.time, "the meeting time"),
    locationName: str(d.locationName, "the place name", { max: 200 }),
    address: str(d.address, "the address", { max: 500 }),
    book: parseBook(d.book),
    archivedAt: FieldValue.serverTimestamp(),
  });
  return { id: ref.id };
});

/** Admin: delete an entry from Past Meetings. */
export const deletePastMeeting = onCall(async (req) => {
  requireAdmin(req);
  const id = str(req.data?.id, "past meeting", { max: 128, required: true });
  await db().collection("pastMeetings").doc(id).delete();
  return { ok: true };
});
