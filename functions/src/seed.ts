import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, nameKey, requireAdmin } from "./lib/common";
import { hashPin } from "./lib/pin";

export const DEMO_MEMBERS = ["Dorothy", "Rose", "Blanche", "Sophia", "Margaret", "Linda"];

/** Emulator only: fills the database with demo members and meetings. All demo PINs are 1234. */
export const seedDemo = onCall(async (req) => {
  if (process.env.FUNCTIONS_EMULATOR !== "true") {
    throw new HttpsError("failed-precondition", "Demo data is only available in the local emulator.");
  }
  requireAdmin(req);
  const batch = db().batch();
  for (const name of DEMO_MEMBERS) {
    const existing = await db().collection("members").where("nameKey", "==", nameKey(name)).limit(1).get();
    if (!existing.empty) continue;
    const ref = db().collection("members").doc();
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
      key: "demo-midnight-library",
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
      book: { key: "", title: p.title, authors: p.authors, coverUrl: "", description: "", year: "" },
      archivedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { ok: true, members: DEMO_MEMBERS, pin: "1234" };
});
