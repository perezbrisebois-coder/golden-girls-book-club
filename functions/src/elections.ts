import { onCall, HttpsError } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { createHmac } from "node:crypto";
import { db, requireAdmin, requireMember, str } from "./lib/common";
import { BALLOT_KEY } from "./lib/secrets";
import { tally } from "./lib/irv";
import { booksChosenForMeetings } from "./meeting";

const elections = () => db().collection("elections");
const ballots = () => db().collection("ballots");

const MAX_CANDIDATES = 100;
/** Every suggestion can be on the ballot, but each member ranks at most this many. */
export const MAX_RANKED = 6;
const BALLOT_OPTS = { secrets: [BALLOT_KEY] };

/**
 * A ballot's document ID is a keyed hash of the election and member. Nobody can
 * read ballots through the app, and someone browsing the raw database in the
 * Google console sees rankings but can't tell whose they are. Ballots store no
 * member ID, name or timestamp.
 */
export function ballotId(electionId: string, memberId: string, key = BALLOT_KEY.value()): string {
  return createHmac("sha256", key).update(`${electionId}:${memberId}`).digest("hex");
}

interface Candidate {
  key: string;
  label: string;
  sublabel: string;
  coverUrl: string;
  book?: Record<string, unknown>;
  place?: Record<string, unknown>;
}

/** Admin: open a vote on some of the current suggestions (all books or all places). */
export const openElection = onCall(async (req) => {
  requireAdmin(req);
  const kind = req.data?.kind;
  if (kind !== "book" && kind !== "place") throw new HttpsError("invalid-argument", "Choose books or places.");
  const title = str(req.data?.title, "the vote title", { max: 100, required: true });
  const raw: unknown[] = Array.isArray(req.data?.candidateKeys) ? req.data.candidateKeys : [];
  const keys = [...new Set(raw.map((k) => str(k, "a choice", { max: 200, required: true })))];
  if (keys.length < 2) throw new HttpsError("invalid-argument", "Please pick at least 2 choices for the ballot.");
  if (keys.length > MAX_CANDIDATES) {
    throw new HttpsError("invalid-argument", `A ballot can have at most ${MAX_CANDIDATES} choices.`);
  }

  const snaps = await db().getAll(...keys.map((k) => db().collection("proposals").doc(k)));
  const candidates: Candidate[] = snaps.map((s) => {
    if (!s.exists) throw new HttpsError("not-found", "One of those suggestions was withdrawn. Please refresh and try again.");
    const p = s.data()!;
    if (p.kind !== kind) throw new HttpsError("invalid-argument", "A ballot can't mix books and places.");
    if (kind === "book") {
      const authors = (p.book.authors as string[]) ?? [];
      return { key: s.id, label: p.book.title, sublabel: authors.join(", "), coverUrl: p.book.coverUrl ?? "", book: p.book };
    }
    return {
      key: s.id,
      label: p.place.name,
      sublabel: p.place.isPrivate ? "Private home" : [p.place.address, p.place.city].filter(Boolean).join(", "),
      coverUrl: "",
      place: p.place,
    };
  });

  if (kind === "book") {
    const chosen = await booksChosenForMeetings();
    const used = candidates.find((c) => chosen.has(c.key));
    if (used) throw new HttpsError("failed-precondition", `"${used.label}" was already chosen for a meeting, so it can't be voted on again.`);
  }

  const ref = elections().doc();
  await ref.create({
    kind,
    title,
    candidates,
    candidateKeys: keys,
    status: "open",
    voters: {},
    results: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { electionId: ref.id };
});

/**
 * Member: cast their ballot. Votes are final: once cast, a ballot can't be
 * changed or taken back. The ballot is filed under a hash of the member's ID
 * from the signed-in session, so nobody can vote as someone else.
 */
export const submitBallot = onCall(BALLOT_OPTS, async (req) => {
  const { memberId, name } = await requireMember(req);
  const electionId = str(req.data?.electionId, "vote", { max: 128, required: true });
  const raw: unknown[] = Array.isArray(req.data?.ranking) ? req.data.ranking : [];
  if (raw.length > MAX_RANKED) throw new HttpsError("invalid-argument", `You can rank up to ${MAX_RANKED} choices.`);
  const ranking = raw.map((k) => str(k, "a choice", { max: 200, required: true }));
  if (new Set(ranking).size !== ranking.length) throw new HttpsError("invalid-argument", "Each choice can only be ranked once.");
  if (ranking.length === 0) throw new HttpsError("invalid-argument", "Please choose at least one.");

  await db().runTransaction(async (tx) => {
    const election = await tx.get(elections().doc(electionId));
    if (!election.exists) throw new HttpsError("not-found", "That vote no longer exists.");
    if (election.get("status") !== "open") throw new HttpsError("failed-precondition", "Voting has closed.");
    const allowed = new Set(election.get("candidateKeys") as string[]);
    if (ranking.some((k) => !allowed.has(k))) throw new HttpsError("invalid-argument", "One of those choices isn't on this ballot.");

    const ballotRef = ballots().doc(ballotId(electionId, memberId));
    if ((await tx.get(ballotRef)).exists) {
      throw new HttpsError("already-exists", "You've already voted. Votes can't be changed once they're in.");
    }
    tx.create(ballotRef, { electionId, ranking });
    tx.update(election.ref, { [`voters.${memberId}`]: name });
  });
  return { ok: true };
});

/** Member: read back their own ranking so they can see how they voted. Nobody else's is ever returned. */
export const getMyBallot = onCall(BALLOT_OPTS, async (req) => {
  const { memberId } = await requireMember(req);
  const electionId = str(req.data?.electionId, "vote", { max: 128, required: true });
  const snap = await ballots().doc(ballotId(electionId, memberId)).get();
  return { ranking: snap.exists ? (snap.get("ranking") as string[]) : [] };
});

/** Admin: close voting, count the ballots with instant-runoff, and publish counts only. */
export const closeElection = onCall(async (req) => {
  requireAdmin(req);
  const electionId = str(req.data?.electionId, "vote", { max: 128, required: true });
  await db().runTransaction(async (tx) => {
    const election = await tx.get(elections().doc(electionId));
    if (!election.exists) throw new HttpsError("not-found", "That vote no longer exists.");
    if (election.get("status") !== "open") throw new HttpsError("failed-precondition", "Voting is already closed.");
    const cast = await tx.get(ballots().where("electionId", "==", electionId));
    const results = tally(
      election.get("candidateKeys") as string[],
      cast.docs.map((d) => d.get("ranking") as string[]),
    );
    tx.update(election.ref, { status: "closed", results, closedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});

/** Admin: reopen a closed vote (e.g. closed too early) so the rest can vote. Ballots are kept; results are hidden again. */
export const reopenElection = onCall(async (req) => {
  requireAdmin(req);
  const electionId = str(req.data?.electionId, "vote", { max: 128, required: true });
  const ref = elections().doc(electionId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "That vote no longer exists.");
  await ref.update({ status: "open", results: null });
  return { ok: true };
});

/** Admin: delete a vote and all its ballots. */
export const deleteElection = onCall(async (req) => {
  requireAdmin(req);
  const electionId = str(req.data?.electionId, "vote", { max: 128, required: true });
  const cast = await ballots().where("electionId", "==", electionId).get();
  const batch = db().batch();
  cast.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(elections().doc(electionId));
  await batch.commit();
  return { ok: true };
});
