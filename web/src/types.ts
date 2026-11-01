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
