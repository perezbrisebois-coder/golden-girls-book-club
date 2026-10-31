import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupClients, clearData, expectCode, newClient } from "./helpers";

// Passwords come from functions/.secret.local in the emulator.
const MEMBER_PW = "member";
const ADMIN_PW = "admin";

beforeEach(clearData);
afterAll(cleanupClients);

describe("shared password", () => {
  it("rejects a wrong password", async () => {
    const c = await newClient();
    await expectCode(c.call("enterPassword", { password: "nope" }), "permission-denied");
    await c.refresh();
    expect((await c.claims()).role).toBeUndefined();
  });

  it("the member password gives the member role", async () => {
    const c = await newClient();
    await c.call("enterPassword", { password: MEMBER_PW });
    await c.refresh();
    expect((await c.claims()).role).toBe("member");
  });

  it("the admin password gives the admin role", async () => {
    const c = await newClient();
    await c.call("enterPassword", { password: ADMIN_PW });
    await c.refresh();
    expect((await c.claims()).role).toBe("admin");
  });

  it("locks out after 5 wrong guesses, even if the 6th is right", async () => {
    const c = await newClient();
    for (let i = 0; i < 5; i++) {
      await expectCode(c.call("enterPassword", { password: `guess${i}` }), "permission-denied");
    }
    await expectCode(c.call("enterPassword", { password: MEMBER_PW }), "resource-exhausted");
  });
});

describe("name + PIN", () => {
  it("can't identify without entering the password first", async () => {
    const c = await newClient();
    await expectCode(c.call("identifyMember", { name: "Rose", pin: "1234", createIfNew: true }), "unauthenticated");
  });

  it("asks before creating a new member (catches typos)", async () => {
    const c = await newClient();
    await c.call("enterPassword", { password: MEMBER_PW });
    await c.refresh();
    const res = await c.call("identifyMember", { name: "Rose", pin: "1234" });
    expect(res).toEqual({ status: "notFound" });
  });

  it("creates a member, then recognises them on another device with the right PIN", async () => {
    const a = await newClient();
    const created = await a.join(MEMBER_PW, "Rose", "4321");
    expect(created.status).toBe("created");
    expect((await a.claims()).memberId).toBe(created.memberId);

    const b = await newClient();
    await b.call("enterPassword", { password: MEMBER_PW });
    await b.refresh();
    const again = await b.call("identifyMember", { name: "  rose ", pin: "4321" });
    expect(again).toMatchObject({ status: "signedIn", memberId: created.memberId, name: "Rose" });
  });

  it("rejects the wrong PIN and locks the member after 5 tries", async () => {
    const a = await newClient();
    await a.join(MEMBER_PW, "Blanche", "1111");
    const b = await newClient();
    await b.call("enterPassword", { password: MEMBER_PW });
    await b.refresh();
    for (let i = 0; i < 5; i++) {
      await expectCode(b.call("identifyMember", { name: "Blanche", pin: "9999" }), "permission-denied");
    }
    await expectCode(b.call("identifyMember", { name: "Blanche", pin: "1111" }), "resource-exhausted");
  });

  it("rejects PINs that aren't exactly 4 digits", async () => {
    const c = await newClient();
    await c.call("enterPassword", { password: MEMBER_PW });
    await c.refresh();
    for (const pin of ["123", "12345", "abcd", ""]) {
      await expectCode(c.call("identifyMember", { name: "Sophia", pin, createIfNew: true }), "invalid-argument");
    }
  });
});

describe("admin-only actions", () => {
  it("members can't clear PINs, remove members or edit the meeting", async () => {
    const m = await newClient();
    const { memberId } = await m.join(MEMBER_PW, "Dorothy");
    await expectCode(m.call("adminClearPin", { memberId }), "permission-denied");
    await expectCode(m.call("adminRemoveMember", { memberId }), "permission-denied");
    await expectCode(m.call("updateMeeting", { date: "2026-12-01" }), "permission-denied");
    await expectCode(m.call("archiveMeeting"), "permission-denied");
  });

  it("admin clears a PIN; the member keeps their profile and sets a new PIN", async () => {
    const m = await newClient();
    const { memberId } = await m.join(MEMBER_PW, "Dorothy", "1111");
    const a = await newClient();
    await a.join(ADMIN_PW, "Admin Annie");
    await a.call("adminClearPin", { memberId });

    const m2 = await newClient();
    await m2.call("enterPassword", { password: MEMBER_PW });
    await m2.refresh();
    const res = await m2.call("identifyMember", { name: "Dorothy", pin: "2222" });
    expect(res).toMatchObject({ status: "pinReset", memberId });
    // the old PIN no longer works, the new one does
    const m3 = await newClient();
    await m3.call("enterPassword", { password: MEMBER_PW });
    await m3.refresh();
    await expectCode(m3.call("identifyMember", { name: "Dorothy", pin: "1111" }), "permission-denied");
    expect(await m3.call("identifyMember", { name: "Dorothy", pin: "2222" })).toMatchObject({ status: "signedIn" });
  });

  it("admin can edit the meeting and archive it", async () => {
    const a = await newClient();
    await a.join(ADMIN_PW, "Admin Annie");
    await a.call("updateMeeting", {
      date: "2026-12-03",
      time: "19:30",
      locationName: "Library",
      address: "1 Main St",
      book: { title: "Rebecca", authors: ["Daphne du Maurier"] },
    });
    await a.call("archiveMeeting");
    await expectCode(a.call("archiveMeeting"), "failed-precondition");
  });

  it("rejects invalid meeting input", async () => {
    const a = await newClient();
    await a.join(ADMIN_PW, "Admin Annie");
    await expectCode(a.call("updateMeeting", { date: "next tuesday" }), "invalid-argument");
    await expectCode(a.call("updateMeeting", { time: "25:00" }), "invalid-argument");
    await expectCode(a.call("updateMeeting", { mapUrl: "javascript:alert(1)" }), "invalid-argument");
  });

  it("a removed member's session stops working", async () => {
    const m = await newClient();
    const { memberId } = await m.join(MEMBER_PW, "Rose");
    const a = await newClient();
    await a.join(ADMIN_PW, "Admin Annie");
    await a.call("adminRemoveMember", { memberId });
    const again = await m.call("identifyMember", { name: "Rose", pin: "1234" });
    expect(again).toEqual({ status: "notFound" });
  });
});
