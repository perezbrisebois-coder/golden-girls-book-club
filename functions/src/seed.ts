import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, nameKey, requireAdmin } from "./lib/common";
import { hashPin } from "./lib/pin";
import { ballotId } from "./elections";
import { BALLOT_KEY } from "./lib/secrets";
import { bookKey } from "./lib/bookSources";

export const DEMO_MEMBERS = ["Dorothy", "Rose", "Blanche", "Sophia", "Margaret", "Linda"];

/** Emulator only: fills the database with demo members and meetings. All demo PINs are 1234. */
export const seedDemo = onCall({ secrets: [BALLOT_KEY] }, async (req) => {
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    throw new HttpsError("failed-precondition", "Demo data is only available in the local emulator.");
  }
  requireAdmin(req);
  const batch = db().batch();
  const memberIds: Record<string, string> = {};
  for (const name of DEMO_MEMBERS) {
    const existing = await db().collection("members").where("nameKey", "==", nameKey(name)).limit(1).get();
    if (!existing.empty) {
      memberIds[name] = existing.docs[0].id;
      continue;
    }
    const ref = db().collection("members").doc();
    memberIds[name] = ref.id;
    batch.set(ref, { name, nameKey: nameKey(name), hasPin: true, createdAt: FieldValue.serverTimestamp() });
    batch.set(db().collection("memberSecrets").doc(ref.id), hashPin("1234"));
  }
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1, 12);
  batch.set(db().collection("config").doc("meeting"), {
    date: nextMonth.toISOString().slice(0, 10),
    time: "19:00",
    locationName: "Rose's house",
    address: "123 Shady Pine Lane, Springfield",
    mapUrl: "",
    notes: "Bring a dessert to share!",
    book: {
      key: bookKey("The Midnight Library", ["Matt Haig"]),
      title: "The Midnight Library",
      authors: ["Matt Haig"],
      coverUrl: "",
      description: "Between life and death there is a library, and every book offers a chance to try another life you could have lived.",
      year: "2020",
    },
    updatedAt: FieldValue.serverTimestamp(),
  });
  const past = [
    { date: "2026-08-14", title: "The Thursday Murder Club", authors: ["Richard Osman"] },
    { date: "2026-09-11", title: "Lessons in Chemistry", authors: ["Bonnie Garmus"] },
  ];
  for (const p of past) {
    batch.set(db().collection("pastMeetings").doc(`demo-${p.date}`), {
      date: p.date,
      time: "19:00",
      locationName: "Blanche's house",
      book: { key: bookKey(p.title, p.authors), title: p.title, authors: p.authors, coverUrl: "", description: "", year: "" },
      archivedAt: FieldValue.serverTimestamp(),
    });
  }
  seedVote(batch, memberIds);
  await batch.commit();
  return { ok: true, members: DEMO_MEMBERS, pin: "1234" };
});

const DEMO_BOOKS = [
  { title: "The Remains of the Day", authors: ["Kazuo Ishiguro"], year: "1989", by: "Dorothy" },
  { title: "Anxious People", authors: ["Fredrik Backman"], year: "2019", by: "Rose" },
  { title: "Tomorrow, and Tomorrow, and Tomorrow", authors: ["Gabrielle Zevin"], year: "2022", by: "Blanche" },
  { title: "West with Giraffes", authors: ["Lynda Rutledge"], year: "2021", by: "Sophia" },
];

/**
 * Demo suggestions plus an open "Next book" vote that 5 demo members have
 * already voted in, so the round-by-round results are interesting to look at.
 */
function seedVote(batch: FirebaseFirestore.WriteBatch, memberIds: Record<string, string>) {
  const books = DEMO_BOOKS.map((b) => ({ ...b, key: bookKey(b.title, b.authors) }));
  for (const b of books) {
    batch.set(db().collection("proposals").doc(b.key), {
      kind: "book",
      key: b.key,
      book: { key: b.key, title: b.title, authors: b.authors, year: b.year, coverUrl: "", description: "", pageCount: null, isbn: "" },
      review: null,
      proposerId: memberIds[b.by] ?? "",
      proposerName: b.by,
      note: "",
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  const [A, B, C, D] = books.map((b) => b.key);
  const electionId = "demo-next-book";
  // Round 1: A 2, B 2, C 1, D 0 → D out, then C out (its voter moves to B) → B wins.
  const rankings: Record<string, string[]> = {
    Dorothy: [A, C],
    Rose: [B, A],
    Blanche: [A, B, C],
    Sophia: [B],
    Margaret: [C, B, D],
  };
  const voters: Record<string, string> = {};
  for (const [name, ranking] of Object.entries(rankings)) {
    const id = memberIds[name];
    if (!id) continue;
    voters[id] = name;
    batch.set(db().collection("ballots").doc(ballotId(electionId, id)), { electionId, ranking });
  }
  batch.set(db().collection("elections").doc(electionId), {
    kind: "book",
    title: "Next book",
    candidates: books.map((b) => ({
      key: b.key,
      label: b.title,
      sublabel: b.authors.join(", "),
      coverUrl: "",
      book: { key: b.key, title: b.title, authors: b.authors, year: b.year, coverUrl: "", description: "" },
    })),
    candidateKeys: books.map((b) => b.key),
    status: "open",
    voters,
    results: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}
