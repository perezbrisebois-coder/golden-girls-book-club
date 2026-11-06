import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collection, getDocs } from "firebase/firestore";
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
  const { id } = await admin.call("openPotluck", { date: "2099-12-10", notes: "Dinner at 7" });
  return { admin, rose, roseId, dot, id };
}

const items = async (c: Awaited<ReturnType<typeof newClient>>, id: string) =>
  (await getDocs(collection(c.db, "potlucks", id, "items"))).docs.map((d) => ({ id: d.id, ...d.data() }) as any);

describe("potluck", () => {
  it("only the admin can start, close or delete a potluck", async () => {
    const { admin, rose, id } = await setup();
    await expectCode(rose.call("openPotluck", { date: "2099-12-11" }), "permission-denied");
    await expectCode(rose.call("updatePotluck", { id, status: "closed" }), "permission-denied");
    await expectCode(rose.call("deletePotluck", { id }), "permission-denied");
    await expectCode(admin.call("openPotluck", { date: "2099-12-10" }), "already-exists");
  });

  it("members sign up with their own name; only they can change it", async () => {
    const { rose, roseId, dot, id } = await setup();
    const { id: itemId } = await rose.call("addPotluckItem", { potluckId: id, dish: "Lemon bars", category: "Dessert", note: "", name: "Fake" });
    expect((await items(dot, id))[0]).toMatchObject({ memberId: roseId, name: "Rose", dish: "Lemon bars", category: "Dessert" });

    await expectCode(dot.call("editPotluckItem", { potluckId: id, id: itemId, dish: "x", category: "Other" }), "permission-denied");
    await expectCode(dot.call("deletePotluckItem", { potluckId: id, id: itemId }), "permission-denied");
    await rose.call("editPotluckItem", { potluckId: id, id: itemId, dish: "Lemon bars (2 trays)", category: "Dessert", note: "nut-free" });
    expect((await items(rose, id))[0]).toMatchObject({ dish: "Lemon bars (2 trays)", note: "nut-free" });
    await rose.call("deletePotluckItem", { potluckId: id, id: itemId });
    expect(await items(rose, id)).toHaveLength(0);
  });

  it("the admin can remove anyone's item", async () => {
    const { admin, rose, id } = await setup();
    const { id: itemId } = await rose.call("addPotluckItem", { potluckId: id, dish: "Salad", category: "Salad" });
    await admin.call("deletePotluckItem", { potluckId: id, id: itemId });
    expect(await items(admin, id)).toHaveLength(0);
  });

  it("validates the type and caps each member at 5 items", async () => {
    const { rose, id } = await setup();
    await expectCode(rose.call("addPotluckItem", { potluckId: id, dish: "Pie", category: "Pudding" }), "invalid-argument");
    for (let i = 0; i < 5; i++) await rose.call("addPotluckItem", { potluckId: id, dish: `Dish ${i}`, category: "Side" });
    await expectCode(rose.call("addPotluckItem", { potluckId: id, dish: "One more", category: "Side" }), "resource-exhausted");
  });

  it("closed sign-ups block new and changed items; deleting removes everything", async () => {
    const { admin, rose, id } = await setup();
    const { id: itemId } = await rose.call("addPotluckItem", { potluckId: id, dish: "Rolls", category: "Side" });
    await admin.call("updatePotluck", { id, status: "closed" });
    await expectCode(rose.call("addPotluckItem", { potluckId: id, dish: "Soup", category: "Other" }), "failed-precondition");
    await expectCode(rose.call("editPotluckItem", { potluckId: id, id: itemId, dish: "Buns", category: "Side" }), "failed-precondition");
    await admin.call("deletePotluck", { id });
    expect(await items(admin, id)).toHaveLength(0);
  });
});
