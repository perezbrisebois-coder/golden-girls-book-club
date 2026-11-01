import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc } from "firebase/firestore";
import { cleanupClients, clearData, expectCode, newClient } from "./helpers";

// The test project uses REVIEW_PROVIDERS=fake (functions/.env.demo-golden-girls): no network, no cost.

beforeEach(clearData);
afterAll(cleanupClients);

const BOOK = {
  title: "Lessons in Chemistry",
  authors: ["Bonnie Garmus"],
  year: "2022",
  coverUrl: "https://covers.openlibrary.org/b/id/12725772-M.jpg",
  description: "A chemist becomes a TV cook.",
  pageCount: 390,
  isbn: "9780385547345",
  key: "anything-the-client-says",
};

async function setup() {
  const admin = await newClient();
  await admin.join("admin", "Admin Annie");
  const rose = await newClient();
  const { memberId: roseId } = await rose.join("member", "Rose");
  const dot = await newClient();
  await dot.join("member", "Dorothy");
  return { admin, rose, roseId, dot };
}

describe("book suggestions", () => {
  it("looks up a review, then posts the book with that review attached", async () => {
    const { rose, roseId } = await setup();
    const { review, unavailable } = await rose.call("getBookReview", { book: BOOK });
    expect(unavailable).toBe(false);
    expect(review.overall).toContain("Lessons in Chemistry");

    const { key } = await rose.call("proposeBook", { book: BOOK, note: "Funny and smart" });
    expect(key).toBe("book-lessons-in-chemistry-garmus"); // server computes the key, ignores the client's
    const snap = await getDoc(doc(rose.db, "proposals", key));
    expect(snap.data()).toMatchObject({
      kind: "book",
      proposerId: roseId,
      proposerName: "Rose",
      note: "Funny and smart",
      book: { title: "Lessons in Chemistry", pageCount: 390 },
    });
    expect(snap.get("review.overall")).toContain("Lessons in Chemistry");
  });

  it("blocks duplicates, including other editions of the same book", async () => {
    const { rose, dot } = await setup();
    await rose.call("proposeBook", { book: BOOK });
    await expectCode(
      dot.call("proposeBook", { book: { ...BOOK, title: "Lessons in Chemistry: A Novel", isbn: "9780385547352" } }),
      "already-exists",
    );
  });

  it("still lets you post when reviews are unavailable, and reviews can be retried later", async () => {
    const { rose } = await setup();
    const book = { ...BOOK, title: "The Unavailable Book" };
    const res = await rose.call("getBookReview", { book });
    expect(res).toEqual({ review: null, unavailable: true });
    const { key } = await rose.call("proposeBook", { book });
    expect((await getDoc(doc(rose.db, "proposals", key))).get("review")).toBeNull();
    const retry = await rose.call("refreshProposalReview", { key });
    expect(retry.unavailable).toBe(true);
  });

  it("only the proposer can edit their note or withdraw; admin can remove any", async () => {
    const { admin, rose, dot } = await setup();
    const { key } = await rose.call("proposeBook", { book: BOOK, note: "first" });
    await expectCode(dot.call("editProposalNote", { key, note: "hijacked" }), "permission-denied");
    await expectCode(dot.call("withdrawProposal", { key }), "permission-denied");
    await expectCode(dot.call("adminRemoveProposal", { key }), "permission-denied");

    await rose.call("editProposalNote", { key, note: "second" });
    expect((await getDoc(doc(rose.db, "proposals", key))).get("note")).toBe("second");

    await admin.call("adminRemoveProposal", { key });
    expect((await getDoc(doc(rose.db, "proposals", key))).exists()).toBe(false);
  });

  it("proposer can withdraw their own suggestion", async () => {
    const { rose } = await setup();
    const { key } = await rose.call("proposeBook", { book: BOOK });
    await rose.call("withdrawProposal", { key });
    expect((await getDoc(doc(rose.db, "proposals", key))).exists()).toBe(false);
  });

  it("needs a name + PIN identity", async () => {
    const c = await newClient();
    await c.call("enterPassword", { password: "member" });
    await c.refresh();
    await expectCode(c.call("proposeBook", { book: BOOK }), "unauthenticated");
    await expectCode(c.call("getBookReview", { book: BOOK }), "unauthenticated");
  });

  it("rejects unsafe cover links", async () => {
    const { rose } = await setup();
    await expectCode(rose.call("proposeBook", { book: { ...BOOK, coverUrl: "javascript:alert(1)" } }), "invalid-argument");
  });
});

describe("place suggestions", () => {
  it("searches places, reviews one, and posts it", async () => {
    const { rose } = await setup();
    const { candidates } = await rose.call("searchPlaces", { query: "Luigi's" });
    expect(candidates[0]).toMatchObject({ name: "Luigi's Bistro", address: "10 Main St" });
    const place = candidates[0];
    const { review } = await rose.call("getPlaceReview", { place });
    expect(review.priceRange).toBe("$$");
    const { key } = await rose.call("proposePlace", { place, note: "Nice and quiet" });
    const snap = await getDoc(doc(rose.db, "proposals", key));
    expect(snap.data()).toMatchObject({ kind: "place", place: { name: "Luigi's Bistro", isPrivate: false } });
    expect(snap.get("review.priceRange")).toBe("$$");
  });

  it("private places skip the lookup and need only name + address", async () => {
    const { rose, dot } = await setup();
    const place = { name: "Rose's house", address: "123 Shady Pine Lane" };
    const { key } = await rose.call("proposePlace", { place, isPrivate: true });
    const snap = await getDoc(doc(rose.db, "proposals", key));
    expect(snap.data()).toMatchObject({ kind: "place", review: null, place: { isPrivate: true } });
    await expectCode(dot.call("proposePlace", { place, isPrivate: true }), "already-exists");
    await expectCode(rose.call("refreshProposalReview", { key }), "failed-precondition");
  });

  it("returns unavailable instead of an error when the AI is down", async () => {
    const { rose } = await setup();
    expect(await rose.call("searchPlaces", { query: "unavailable cafe" })).toEqual({ candidates: [], unavailable: true });
  });
});
