import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, getDocs, collection } from "firebase/firestore";
import { cleanupClients, clearData, expectCode, newClient } from "./helpers";

beforeEach(clearData);
afterAll(cleanupClients);

async function setup() {
  const admin = await newClient();
  await admin.join("admin", "Admin Annie");
  const rose = await newClient();
  const roseRes = await rose.join("member", "Rose");
  const dot = await newClient();
  await dot.join("member", "Dorothy");
  return { admin, rose, roseId: roseRes.memberId as string, dot };
}

describe("date poll", () => {
  it("only admins can open and close polls", async () => {
    const { admin, rose } = await setup();
    await expectCode(rose.call("openPoll", { month: "2026-12" }), "permission-denied");
    const { pollId } = await admin.call("openPoll", { month: "2026-12" });
    await expectCode(rose.call("closePoll", { pollId, finalDate: "2026-12-03" }), "permission-denied");
    await expectCode(rose.call("reopenPoll", { pollId }), "permission-denied");
  });

  it("only one poll can be open at a time", async () => {
    const { admin } = await setup();
    await admin.call("openPoll", { month: "2026-12" });
    await expectCode(admin.call("openPoll", { month: "2027-01" }), "failed-precondition");
  });

  it("candidate dates must be in the chosen month", async () => {
    const { admin } = await setup();
    await expectCode(admin.call("openPoll", { month: "2026-12", candidateDates: ["2027-01-05"] }), "invalid-argument");
  });

  it("members save their own dates, and can only pick dates in the poll", async () => {
    const { admin, rose, roseId } = await setup();
    const { pollId } = await admin.call("openPoll", { month: "2026-12", candidateDates: ["2026-12-03", "2026-12-10"] });
    await rose.call("setAvailability", { pollId, dates: ["2026-12-03"] });
    await expectCode(rose.call("setAvailability", { pollId, dates: ["2026-12-04"] }), "invalid-argument");
    const snap = await getDoc(doc(rose.db, "polls", pollId, "availability", roseId));
    expect(snap.data()).toMatchObject({ name: "Rose", dates: ["2026-12-03"] });
  });

  it("a member can't change someone else's dates (the member comes from their own session)", async () => {
    const { admin, rose, roseId, dot } = await setup();
    const { pollId } = await admin.call("openPoll", { month: "2026-12" });
    await rose.call("setAvailability", { pollId, dates: ["2026-12-03"] });
    // Dorothy tries to sneak in Rose's ID: ignored, she only writes her own entry
    await dot.call("setAvailability", { pollId, dates: ["2026-12-20"], memberId: roseId });
    const roseSnap = await getDoc(doc(rose.db, "polls", pollId, "availability", roseId));
    expect(roseSnap.get("dates")).toEqual(["2026-12-03"]);
    const all = await getDocs(collection(rose.db, "polls", pollId, "availability"));
    expect(all.size).toBe(2);
  });

  it("must be identified by name + PIN to answer", async () => {
    const { admin } = await setup();
    const { pollId } = await admin.call("openPoll", { month: "2026-12" });
    const stranger = await newClient();
    await stranger.call("enterPassword", { password: "member" });
    await stranger.refresh();
    await expectCode(stranger.call("setAvailability", { pollId, dates: [] }), "unauthenticated");
  });

  it("closing with a final date updates Meeting Info and blocks further changes", async () => {
    const { admin, rose } = await setup();
    const { pollId } = await admin.call("openPoll", { month: "2026-12" });
    await admin.call("closePoll", { pollId, finalDate: "2026-12-10", time: "18:30" });
    const meeting = await getDoc(doc(rose.db, "config", "meeting"));
    expect(meeting.data()).toMatchObject({ date: "2026-12-10", time: "18:30" });
    await expectCode(rose.call("setAvailability", { pollId, dates: ["2026-12-10"] }), "failed-precondition");
    await admin.call("reopenPoll", { pollId });
    await rose.call("setAvailability", { pollId, dates: ["2026-12-10"] });
  });

  it("removing a member deletes their dates and blocks their session", async () => {
    const { admin, rose, roseId } = await setup();
    const { pollId } = await admin.call("openPoll", { month: "2026-12" });
    await rose.call("setAvailability", { pollId, dates: ["2026-12-03"] });
    await admin.call("adminRemoveMember", { memberId: roseId });
    const snap = await getDoc(doc(admin.db, "polls", pollId, "availability", roseId));
    expect(snap.exists()).toBe(false);
    await expectCode(rose.call("setAvailability", { pollId, dates: [] }), "unauthenticated");
  });
});
