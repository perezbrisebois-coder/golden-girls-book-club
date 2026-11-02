import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { cleanupClients, clearData, expectCode, newClient } from "./helpers";

beforeEach(clearData);
afterAll(cleanupClients);

async function setup() {
  const admin = await newClient();
  await admin.join("admin", "Admin Annie");
  const rose = await newClient();
  const { memberId: roseId } = await rose.join("member", "Rose");
  const dot = await newClient();
  await dot.join("member", "Dorothy");
  return { admin, rose, roseId, dot };
}

describe("comments", () => {
  it("posts with the member's name attached automatically", async () => {
    const { rose, roseId } = await setup();
    const { id } = await rose.call("postComment", { text: "  Loved it!  ", authorName: "Someone else" });
    const c = (await getDoc(doc(rose.db, "comments", id))).data()!;
    expect(c).toMatchObject({ authorId: roseId, authorName: "Rose", text: "Loved it!", parentId: null, pinned: false, editedAt: null });
  });

  it("requires name + PIN, not just the password", async () => {
    const anon = await newClient();
    await anon.call("enterPassword", { password: "member" });
    await anon.refresh();
    await expectCode(anon.call("postComment", { text: "hi" }), "unauthenticated");
  });

  it("only the author can edit, and edits are labeled", async () => {
    const { admin, rose, dot } = await setup();
    const { id } = await rose.call("postComment", { text: "first" });
    await expectCode(dot.call("editComment", { id, text: "hacked" }), "permission-denied");
    await expectCode(admin.call("editComment", { id, text: "hacked" }), "permission-denied");
    await rose.call("editComment", { id, text: "second" });
    const c = await getDoc(doc(rose.db, "comments", id));
    expect(c.get("text")).toBe("second");
    expect(c.get("editedAt")).not.toBeNull();
  });

  it("authors can delete their own; admin can delete any; others can't", async () => {
    const { admin, rose, dot } = await setup();
    const { id: a } = await rose.call("postComment", { text: "a" });
    const { id: b } = await rose.call("postComment", { text: "b" });
    await expectCode(dot.call("deleteComment", { id: a }), "permission-denied");
    await rose.call("deleteComment", { id: a });
    await admin.call("deleteComment", { id: b });
    expect((await getDocs(collection(rose.db, "comments"))).size).toBe(0);
  });

  it("replies are one level deep and are deleted with their comment", async () => {
    const { rose, dot } = await setup();
    const { id: top } = await rose.call("postComment", { text: "top" });
    const { id: r1 } = await dot.call("postComment", { text: "reply", parentId: top });
    const { id: r2 } = await rose.call("postComment", { text: "reply to reply", parentId: r1 });
    expect((await getDoc(doc(rose.db, "comments", r2))).get("parentId")).toBe(top);
    await rose.call("deleteComment", { id: top });
    expect((await getDocs(query(collection(rose.db, "comments"), where("parentId", "==", top)))).size).toBe(0);
  });

  it("only the admin can pin, and only top-level comments", async () => {
    const { admin, rose } = await setup();
    const { id } = await rose.call("postComment", { text: "pin me" });
    const { id: reply } = await rose.call("postComment", { text: "reply", parentId: id });
    await expectCode(rose.call("pinComment", { id, pinned: true }), "permission-denied");
    await admin.call("pinComment", { id, pinned: true });
    expect((await getDoc(doc(rose.db, "comments", id))).get("pinned")).toBe(true);
    await expectCode(admin.call("pinComment", { id: reply, pinned: true }), "invalid-argument");
  });

  it("clients can't write comments directly", async () => {
    const { rose } = await setup();
    const { setDoc } = await import("firebase/firestore");
    await expect(setDoc(doc(rose.db, "comments", "x"), { text: "sneaky" })).rejects.toThrow();
  });
});

describe("past meetings", () => {
  it("admin can add a past meeting; its book is then left off votes", async () => {
    const { admin, rose } = await setup();
    const book = { title: "Theo of Golden", authors: ["Allen Levi"] };
    await expectCode(rose.call("addPastMeeting", { date: "2026-10-29", book }), "permission-denied");
    await expectCode(admin.call("addPastMeeting", { date: "2999-01-01", book }), "invalid-argument");
    const { id } = await admin.call("addPastMeeting", {
      date: "2026-10-29",
      time: "19:00",
      locationName: "Kristen's house",
      address: "3 Shady Brook Court, Timonium, MD",
      book,
    });
    expect((await getDoc(doc(rose.db, "pastMeetings", id))).data()).toMatchObject({
      date: "2026-10-29",
      time: "19:00",
      address: "3 Shady Brook Court, Timonium, MD",
      book: { key: "book-theo-of-golden-levi", title: "Theo of Golden" },
    });

    const { key } = await rose.call("proposeBook", { book: { ...book, year: "2023", coverUrl: "", description: "", pageCount: null, isbn: "", key: "" } });
    const { key: other } = await rose.call("proposeBook", { book: { title: "Circe", authors: ["Madeline Miller"], year: "", coverUrl: "", description: "", pageCount: null, isbn: "", key: "" } });
    const { key: third } = await rose.call("proposeBook", { book: { title: "Beartown", authors: ["Fredrik Backman"], year: "", coverUrl: "", description: "", pageCount: null, isbn: "", key: "" } });
    await expectCode(admin.call("openElection", { kind: "book", title: "Next", candidateKeys: [key, other] }), "failed-precondition");
    await admin.call("openElection", { kind: "book", title: "Next", candidateKeys: [other, third] });
  });
});
