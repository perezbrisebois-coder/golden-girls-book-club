import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

const READABLE = [
  "config/meeting",
  "pastMeetings/p1",
  "members/m1",
  "polls/poll1",
  "polls/poll1/availability/m1",
  "proposals/b1",
  "elections/e1",
  "comments/c1",
];
const SECRET = ["memberSecrets/m1", "ballots/x1", "bookSearchCache/q1", "placeSearchCache/q1", "reviewCache/r1", "rateLimits/k1", "somethingElse/z"];

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-golden-girls",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
afterAll(() => env.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const path of [...READABLE, ...SECRET]) await setDoc(doc(ctx.firestore(), path), { x: 1 });
  });
});

const anyone = () => env.unauthenticatedContext().firestore();
const noPassword = () => env.authenticatedContext("anon1", {}).firestore();
const member = () => env.authenticatedContext("u1", { role: "member", memberId: "m1" }).firestore();
const admin = () => env.authenticatedContext("u2", { role: "admin", memberId: "m2" }).firestore();

describe("reading", () => {
  it("signed-out visitors can't read anything", async () => {
    for (const p of READABLE) await assertFails(getDoc(doc(anyone(), p)));
  });
  it("sessions that haven't entered the password can't read anything", async () => {
    for (const p of READABLE) await assertFails(getDoc(doc(noPassword(), p)));
  });
  it("a made-up role claim doesn't help", async () => {
    const fake = env.authenticatedContext("u9", { role: "superuser" }).firestore();
    await assertFails(getDoc(doc(fake, "config/meeting")));
  });
  it("members and admins can read the shared club data", async () => {
    for (const p of READABLE) {
      await assertSucceeds(getDoc(doc(member(), p)));
      await assertSucceeds(getDoc(doc(admin(), p)));
    }
  });
  it("nobody, not even the admin, can read PINs, ballots, caches or rate limits", async () => {
    for (const p of SECRET) {
      await assertFails(getDoc(doc(member(), p)));
      await assertFails(getDoc(doc(admin(), p)));
    }
  });
});

describe("writing", () => {
  it("clients can never create, edit or delete. All writes go through Cloud Functions", async () => {
    for (const db of [anyone(), noPassword(), member(), admin()]) {
      for (const p of [...READABLE, ...SECRET]) {
        await assertFails(setDoc(doc(db, p), { hacked: true }));
        await assertFails(updateDoc(doc(db, p), { hacked: true }));
        await assertFails(deleteDoc(doc(db, p)));
      }
      await assertFails(setDoc(doc(db, "comments/new"), { text: "hi" }));
    }
  });
});
