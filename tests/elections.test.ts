import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { cleanupClients, clearData, expectCode, newClient } from "./helpers";

beforeEach(clearData);
afterAll(cleanupClients);

const book = (title: string, author: string) => ({
  title,
  authors: [author],
  year: "2020",
  coverUrl: "",
  description: "",
  pageCount: null,
  isbn: "",
  key: "",
});

async function setup() {
  const admin = await newClient();
  await admin.join("admin", "Admin Annie");
  const rose = await newClient();
  const { memberId: roseId } = await rose.join("member", "Rose");
  const dot = await newClient();
  await dot.join("member", "Dorothy");
  const blanche = await newClient();
  await blanche.join("member", "Blanche");

  const { key: A } = await rose.call("proposeBook", { book: book("Anxious People", "Fredrik Backman") });
  const { key: B } = await dot.call("proposeBook", { book: book("Beartown", "Fredrik Backman") });
  const { key: C } = await blanche.call("proposeBook", { book: book("Circe", "Madeline Miller") });
  const { key: P } = await rose.call("proposePlace", {
    place: { name: "Rose's house", address: "1 Pine Lane", city: "Springfield", phone: "", website: "", description: "" },
    isPrivate: true,
  });
  return { admin, rose, roseId, dot, blanche, A, B, C, P };
}

async function openBookVote(s: Awaited<ReturnType<typeof setup>>) {
  const { electionId } = await s.admin.call("openElection", { kind: "book", title: "Next book", candidateKeys: [s.A, s.B, s.C] });
  return electionId as string;
}

describe("voting", () => {
  it("only the admin can open, close, reopen, delete, or send a winner", async () => {
    const s = await setup();
    await expectCode(s.rose.call("openElection", { kind: "book", title: "x", candidateKeys: [s.A, s.B] }), "permission-denied");
    const id = await openBookVote(s);
    for (const fn of ["closeElection", "reopenElection", "deleteElection"]) {
      await expectCode(s.rose.call(fn, { electionId: id }), "permission-denied");
    }
  });

  it("rejects ballots that mix kinds or have fewer than 2 choices", async () => {
    const s = await setup();
    await expectCode(s.admin.call("openElection", { kind: "book", title: "x", candidateKeys: [s.A, s.P] }), "invalid-argument");
    await expectCode(s.admin.call("openElection", { kind: "book", title: "x", candidateKeys: [s.A] }), "invalid-argument");
  });

  it("leaves books already chosen for a meeting off future ballots", async () => {
    const s = await setup();
    const meeting = { date: "", time: "", locationName: "", address: "", mapUrl: "", notes: "" };
    // Typed in by hand with slightly different wording: still recognised as the same book.
    await s.admin.call("updateMeeting", { ...meeting, book: { title: "Anxious People: A Novel", authors: ["Fredrik Backman"] } });
    expect((await getDoc(doc(s.rose.db, "config", "meeting"))).get("book.key")).toBe(s.A);
    await expectCode(
      s.admin.call("openElection", { kind: "book", title: "Next", candidateKeys: [s.A, s.B, s.C] }),
      "failed-precondition",
    );

    // Still blocked once that meeting moves to Past Meetings.
    await s.admin.call("updateMeeting", { ...meeting, date: "2026-12-10", book: { title: "Anxious People", authors: ["Fredrik Backman"] } });
    await s.admin.call("archiveMeeting", {});
    await expectCode(
      s.admin.call("openElection", { kind: "book", title: "Next", candidateKeys: [s.A, s.B] }),
      "failed-precondition",
    );
    await s.admin.call("openElection", { kind: "book", title: "Next", candidateKeys: [s.B, s.C] });
  });

  it("keeps ballots secret: shows who voted, never what they chose", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await s.rose.call("submitBallot", { electionId: id, ranking: [s.C, s.A] });

    const election = await getDoc(doc(s.dot.db, "elections", id));
    expect(election.get("voters")).toEqual({ [s.roseId]: "Rose" });
    expect(election.get("results")).toBeNull();
    expect(JSON.stringify(election.data())).not.toContain("ranking");

    // Nobody can read ballots directly, not even the admin.
    await expect(getDocs(collection(s.admin.db, "ballots"))).rejects.toThrow();

    // Members only ever get their own ballot back.
    expect((await s.rose.call("getMyBallot", { electionId: id })).ranking).toEqual([s.C, s.A]);
    expect((await s.dot.call("getMyBallot", { electionId: id })).ranking).toEqual([]);
  });

  it("votes are final: no changing or taking back once cast", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await s.rose.call("submitBallot", { electionId: id, ranking: [s.A] });
    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: [s.B, s.A] }), "already-exists");
    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: [] }), "invalid-argument");
    expect((await s.rose.call("getMyBallot", { electionId: id })).ranking).toEqual([s.A]);
    expect((await getDoc(doc(s.rose.db, "elections", id))).get("voters")).toEqual({ [s.roseId]: "Rose" });
  });

  it("validates rankings", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: [s.A, s.A] }), "invalid-argument");
    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: [s.P] }), "invalid-argument");
    // Each member ranks at most 6, however many books are on the ballot.
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: seven }), "invalid-argument");
  });

  it("closes with an instant-runoff tally, then blocks further voting", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    // Round 1: A 2, B 1, C 1 (out of 4: no majority). B and C tied → B is ranked
    // lower on more ballots → B out, its voter moves to A → A wins 3 of 4.
    await s.rose.call("submitBallot", { electionId: id, ranking: [s.A, s.C] });
    await s.admin.call("submitBallot", { electionId: id, ranking: [s.A, s.C] });
    await s.dot.call("submitBallot", { electionId: id, ranking: [s.B, s.A] });
    await s.blanche.call("submitBallot", { electionId: id, ranking: [s.C] });
    await s.admin.call("closeElection", { electionId: id });

    const results = (await getDoc(doc(s.rose.db, "elections", id))).get("results");
    expect(results.totalBallots).toBe(4);
    expect(results.winner).toBe(s.A);
    expect(results.rounds[0].eliminated).toBe(s.B);
    expect(results.rounds[0].tieBreak).toEqual({ tied: [s.B, s.C], method: "ranked-lower" });
    expect(JSON.stringify(results)).not.toMatch(/Rose|Dorothy|Blanche|Annie/);

    await expectCode(s.rose.call("submitBallot", { electionId: id, ranking: [s.B] }), "failed-precondition");
  });

  it("blocks withdrawing a suggestion that is on an open ballot", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await expectCode(s.rose.call("withdrawProposal", { key: s.A }), "failed-precondition");
    await s.admin.call("closeElection", { electionId: id });
    await s.rose.call("withdrawProposal", { key: s.A });
  });

  it("reopening hides results and keeps ballots; deleting removes everything", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await s.rose.call("submitBallot", { electionId: id, ranking: [s.A] });
    await s.admin.call("closeElection", { electionId: id });
    await s.admin.call("reopenElection", { electionId: id });
    expect((await getDoc(doc(s.rose.db, "elections", id))).get("results")).toBeNull();
    expect((await s.rose.call("getMyBallot", { electionId: id })).ranking).toEqual([s.A]);

    await s.admin.call("deleteElection", { electionId: id });
    expect((await getDoc(doc(s.rose.db, "elections", id))).exists()).toBe(false);
    expect((await s.rose.call("getMyBallot", { electionId: id })).ranking).toEqual([]);
  });

  it("removing a member removes their ballot from open votes", async () => {
    const s = await setup();
    const id = await openBookVote(s);
    await s.rose.call("submitBallot", { electionId: id, ranking: [s.A] });
    await s.admin.call("adminRemoveMember", { memberId: s.roseId });
    expect((await getDoc(doc(s.dot.db, "elections", id))).get("voters")).toEqual({});
    await s.admin.call("closeElection", { electionId: id });
    expect((await getDoc(doc(s.dot.db, "elections", id))).get("results.totalBallots")).toBe(0);
  });
});
