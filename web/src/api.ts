import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { BookInfo, Role } from "./types";

function call<Req, Res>(name: string) {
  const fn = httpsCallable<Req, Res>(functions, name);
  return async (data: Req): Promise<Res> => (await fn(data)).data;
}

export type IdentifyResult =
  | { status: "notFound" }
  | { status: "signedIn" | "created" | "pinReset"; memberId: string; name: string };

export const api = {
  enterPassword: call<{ password: string }, { role: Role }>("enterPassword"),
  identifyMember: call<{ name: string; pin: string; createIfNew?: boolean }, IdentifyResult>("identifyMember"),
  switchMember: call<Record<string, never>, { ok: true }>("switchMember"),
  adminClearPin: call<{ memberId: string }, { ok: true }>("adminClearPin"),
  adminRemoveMember: call<{ memberId: string }, { ok: true }>("adminRemoveMember"),

  updateMeeting: call<
    {
      date: string;
      time: string;
      locationName: string;
      address: string;
      mapUrl: string;
      notes: string;
      book: BookInfo | null;
    },
    { ok: true }
  >("updateMeeting"),
  archiveMeeting: call<Record<string, never>, { ok: true }>("archiveMeeting"),
  deletePastMeeting: call<{ id: string }, { ok: true }>("deletePastMeeting"),

  seedDemo: call<Record<string, never>, { ok: true; members: string[]; pin: string }>("seedDemo"),
};

/** Turns a Firebase error into a sentence suitable for showing to members. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/internal" || e?.code === "functions/unavailable") {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  if (e?.message && e.code?.startsWith("functions/")) return e.message;
  if (e?.code === "permission-denied") return "You don't have access to that. Try reloading the page.";
  return "Something went wrong. Please check your internet connection and try again.";
}
