import type { BookQuery, BookReview, PlaceCandidate, PlaceReview, ReviewProvider, WebBook } from "./types";
import { ProviderUnavailableError } from "./types";

/**
 * Deterministic provider for the local emulator and automated tests. Never
 * calls the network. A title or place containing "unavailable" simulates an
 * outage so the "reviews unavailable right now" path can be tested.
 */
export class FakeProvider implements ReviewProvider {
  readonly name = "fake";

  async suggestBookSearches(query: string): Promise<string[]> {
    return /chemestry/i.test(query) ? ["Lessons in Chemistry by Bonnie Garmus"] : [];
  }

  async summarizeBook(book: BookQuery): Promise<BookReview> {
    if (/unavailable/i.test(book.title)) throw new ProviderUnavailableError("simulated outage");
    return {
      overall: `Test summary for "${book.title}". Critics and readers are broadly positive.`,
      criticSentiment: "Mostly positive",
      readerSentiment: "Very positive",
      praise: ["Memorable characters", "Great for discussion"],
      criticism: ["Slow middle section"],
      disagreements: "",
      genre: "Fiction",
      pageCount: 320,
      sources: [{ title: "Example review", url: "https://example.com/review" }],
    };
  }

  async findBooks(query: string): Promise<WebBook[]> {
    if (/unavailable/i.test(query)) throw new ProviderUnavailableError("simulated outage");
    if (/nothing/i.test(query)) return [];
    return [{ title: `${query} (web)`, authors: ["Web Author"], year: "2026", description: "Found on the web." }];
  }

  async findPlaces(query: string): Promise<PlaceCandidate[]> {
    if (/unavailable/i.test(query)) throw new ProviderUnavailableError("simulated outage");
    return [
      {
        name: `${query} Bistro`,
        address: "10 Main St",
        city: "Springfield, IL",
        phone: "(555) 010-0000",
        website: "https://example.com",
        description: "Italian restaurant",
      },
    ];
  }

  async summarizePlace(place: PlaceCandidate): Promise<PlaceReview> {
    return {
      overall: `Test summary for ${place.name}.`,
      priceRange: "$$",
      noise: "Quiet enough to talk",
      parking: "Free lot",
      accessibility: "Step-free entrance",
      groups: "Takes reservations for groups; has a private room",
      praise: ["Friendly staff"],
      criticism: ["Small portions"],
      sources: [{ title: "Example listing", url: "https://example.com/place" }],
    };
  }
}
