import type { Timestamp } from "firebase/firestore";

export type Role = "member" | "admin";

export interface BookInfo {
  key: string;
  title: string;
  authors: string[];
  coverUrl: string;
  description: string;
  year: string;
}

export interface Meeting {
  date: string; // YYYY-MM-DD or ""
  time: string; // HH:MM or ""
  locationName: string;
  address: string;
  mapUrl: string;
  notes: string;
  book: BookInfo | null;
}

export interface PastMeeting {
  id: string;
  date: string;
  time: string;
  locationName: string;
  book: BookInfo | null;
}

export interface Member {
  id: string;
  name: string;
  hasPin: boolean;
  createdAt?: Timestamp;
}

export interface Poll {
  id: string;
  month: string; // YYYY-MM
  candidateDates: string[]; // empty = every day of the month
  note: string;
  status: "open" | "closed";
  finalDate: string;
  createdAt?: Timestamp;
}

export interface Availability {
  id: string; // member ID
  memberId: string;
  name: string;
  dates: string[];
}

export interface Source {
  title: string;
  url: string;
}

export interface BookReview {
  overall: string;
  criticSentiment: string;
  readerSentiment: string;
  praise: string[];
  criticism: string[];
  disagreements: string;
  genre: string;
  pageCount: number | null;
  sources: Source[];
}

export interface PlaceReview {
  overall: string;
  priceRange: string;
  noise: string;
  parking: string;
  accessibility: string;
  groups: string;
  praise: string[];
  criticism: string[];
  sources: Source[];
}

export interface BookCandidate {
  key: string;
  title: string;
  authors: string[];
  year: string;
  coverUrl: string;
  description: string;
  pageCount: number | null;
  isbn: string;
}

export interface PlaceInfo {
  key: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  website: string;
  description: string;
  isPrivate?: boolean;
}

export interface Proposal {
  id: string;
  key: string;
  kind: "book" | "place";
  book?: BookCandidate;
  place?: PlaceInfo;
  review: BookReview | PlaceReview | null;
  proposerId: string;
  proposerName: string;
  note: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface ElectionCandidate {
  key: string;
  label: string;
  sublabel: string;
  coverUrl: string;
  book?: BookInfo;
  place?: PlaceInfo;
}

export type TieBreakMethod = "earlier-round" | "ranked-lower" | "random";

export interface TallyRound {
  counts: { key: string; votes: number }[];
  exhausted: number;
  eliminated: string | null;
  winner: string | null;
  tieBreak: { tied: string[]; method: TieBreakMethod } | null;
}

export interface TallyResult {
  winner: string | null;
  totalBallots: number;
  rounds: TallyRound[];
}

export interface Election {
  id: string;
  kind: "book" | "place";
  title: string;
  candidates: ElectionCandidate[];
  candidateKeys: string[];
  status: "open" | "closed";
  /** memberId → name of everyone who has voted (never their choices). */
  voters: Record<string, string>;
  results: TallyResult | null;
  createdAt?: Timestamp;
  closedAt?: Timestamp;
}
