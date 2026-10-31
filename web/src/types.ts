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
