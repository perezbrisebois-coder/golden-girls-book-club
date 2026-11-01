/**
 * The "review provider" interface. Each provider (Claude today; OpenAI or
 * Gemini later) implements these methods. The active providers are chosen by
 * the REVIEW_PROVIDERS environment variable, e.g. "claude" or "claude,openai";
 * they are tried in order until one succeeds.
 */

export interface Source {
  title: string;
  url: string;
}

export interface BookQuery {
  title: string;
  authors: string[];
  year: string;
}

export interface BookReview {
  overall: string; // 2–4 sentence neutral summary of reception
  criticSentiment: string; // e.g. "Mostly positive"
  readerSentiment: string;
  praise: string[];
  criticism: string[];
  disagreements: string; // where sources disagree, or ""
  genre: string;
  pageCount: number | null;
  sources: Source[];
}

export interface PlaceCandidate {
  name: string;
  address: string; // street address
  city: string; // city, state
  phone: string;
  website: string;
  description: string; // one line: type of place / cuisine
}

export interface PlaceReview {
  overall: string;
  priceRange: string; // "$", "$$", "$$$", "$$$$" or "Unknown"
  noise: string; // e.g. "Quiet enough to talk"
  parking: string;
  accessibility: string;
  groups: string; // good for groups / private room / reservations
  praise: string[];
  criticism: string[];
  sources: Source[];
}

export interface ReviewProvider {
  readonly name: string;
  /** Fixes spelling / fills in a vague book search, e.g. "chemestry garmus" -> ["Lessons in Chemistry by Bonnie Garmus"]. */
  suggestBookSearches(query: string): Promise<string[]>;
  summarizeBook(book: BookQuery): Promise<BookReview>;
  findPlaces(query: string): Promise<PlaceCandidate[]>;
  summarizePlace(place: PlaceCandidate): Promise<PlaceReview>;
}

/** Thrown when a provider can't produce a usable answer (timeout, refusal, no result). */
export class ProviderUnavailableError extends Error {}
