import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { BookCandidate, BookInfo, BookReview, PlaceInfo, PlaceReview, Role } from "./types";

function call<Req, Res>(name: string, timeoutMs = 70_000) {
  const fn = httpsCallable<Req, Res>(functions, name, { timeout: timeoutMs });
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
  addPastMeeting: call<
    { date: string; time: string; locationName: string; address: string; book: BookInfo | null },
    { id: string }
  >("addPastMeeting"),
  deletePastMeeting: call<{ id: string }, { ok: true }>("deletePastMeeting"),

  openPoll: call<{ month: string; candidateDates: string[]; note: string }, { pollId: string }>("openPoll"),
  setAvailability: call<{ pollId: string; dates: string[] }, { ok: true }>("setAvailability"),
  closePoll: call<{ pollId: string; finalDate: string; time: string }, { ok: true }>("closePoll"),
  reopenPoll: call<{ pollId: string }, { ok: true }>("reopenPoll"),

  // AI lookups can take up to a few minutes
  searchBooks: call<{ query: string }, { candidates: BookCandidate[]; searchedFor: string }>("searchBooks", 240_000),
  getBookReview: call<{ book: { title: string; authors: string[]; year: string } }, { review: BookReview | null; unavailable: boolean }>(
    "getBookReview",
    240_000,
  ),
  searchPlaces: call<{ query: string }, { candidates: PlaceInfo[]; unavailable: boolean }>("searchPlaces", 240_000),
  getPlaceReview: call<{ place: PlaceInfo }, { review: PlaceReview | null; unavailable: boolean }>("getPlaceReview", 240_000),
  proposeBook: call<{ book: BookCandidate; note: string }, { key: string }>("proposeBook"),
  proposePlace: call<{ place: Omit<PlaceInfo, "key">; note: string; isPrivate: boolean }, { key: string }>("proposePlace"),
  editProposalNote: call<{ key: string; note: string }, { ok: true }>("editProposalNote"),
  withdrawProposal: call<{ key: string }, { ok: true }>("withdrawProposal"),
  adminRemoveProposal: call<{ key: string }, { ok: true }>("adminRemoveProposal"),
  refreshProposalReview: call<{ key: string }, { ok: true; unavailable: boolean }>("refreshProposalReview", 240_000),

  openElection: call<{ kind: "book" | "place"; title: string; candidateKeys: string[] }, { electionId: string }>("openElection"),
  submitBallot: call<{ electionId: string; ranking: string[] }, { ok: true }>("submitBallot"),
  getMyBallot: call<{ electionId: string }, { ranking: string[] }>("getMyBallot"),
  closeElection: call<{ electionId: string }, { ok: true }>("closeElection"),
  reopenElection: call<{ electionId: string }, { ok: true }>("reopenElection"),
  deleteElection: call<{ electionId: string }, { ok: true }>("deleteElection"),

  postComment: call<{ text: string; parentId?: string }, { id: string }>("postComment"),
  editComment: call<{ id: string; text: string }, { ok: true }>("editComment"),
  deleteComment: call<{ id: string }, { ok: true }>("deleteComment"),
  pinComment: call<{ id: string; pinned: boolean }, { ok: true }>("pinComment"),

  openPotluck: call<{ date: string; notes: string }, { id: string }>("openPotluck"),
  updatePotluck: call<{ id: string; notes?: string; status?: "open" | "closed" }, { ok: true }>("updatePotluck"),
  deletePotluck: call<{ id: string }, { ok: true }>("deletePotluck"),
  addPotluckItem: call<{ potluckId: string; dish: string; category: string; note: string }, { id: string }>("addPotluckItem"),
  editPotluckItem: call<{ potluckId: string; id: string; dish: string; category: string; note: string }, { ok: true }>(
    "editPotluckItem",
  ),
  deletePotluckItem: call<{ potluckId: string; id: string }, { ok: true }>("deletePotluckItem"),

  seedDemo: call<Record<string, never>, { ok: true; members: string[]; pin: string }>("seedDemo"),
};

/** Turns a Firebase error into a sentence suitable for showing to members. */
export function friendlyError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.code === "functions/deadline-exceeded") {
    return "That took too long. Please try again.";
  }
  if (e?.code === "functions/unavailable" && e.message && e.message !== "unavailable") return e.message;
  if (e?.code === "functions/internal" || e?.code === "functions/unavailable") {
    return "Something went wrong on our end. Please try again in a moment.";
  }
  if (e?.message && e.code?.startsWith("functions/")) return e.message;
  if (e?.code === "permission-denied") return "You don't have access to that. Try reloading the page.";
  return "Something went wrong. Please check your internet connection and try again.";
}
