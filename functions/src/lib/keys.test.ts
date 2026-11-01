import { describe, expect, it } from "vitest";
import { bookKey, normalize } from "./bookSources";
import { checkSources } from "../reviews/claude";

describe("bookKey", () => {
  it("matches different editions and spellings of the same book", () => {
    const k = bookKey("Lessons in Chemistry", ["Bonnie Garmus"]);
    expect(bookKey("Lessons in Chemistry: A Novel", ["Bonnie Garmus"])).toBe(k);
    expect(bookKey("LESSONS IN CHEMISTRY (Large Print)", ["Garmus, Bonnie".split(", ").reverse().join(" ")])).toBe(k);
  });
  it("ignores leading articles and accents", () => {
    expect(bookKey("The Thursday Murder Club", ["Richard Osman"])).toBe(bookKey("Thursday Murder Club", ["Richard Osman"]));
    expect(normalize("Café Société")).toBe("cafe societe");
  });
  it("different authors give different keys", () => {
    expect(bookKey("Rebecca", ["Daphne du Maurier"])).not.toBe(bookKey("Rebecca", ["Someone Else"]));
  });
});

describe("checkSources", () => {
  const searched = [
    { title: "Kirkus", url: "https://www.kirkusreviews.com/book-reviews/x/" },
    { title: "Goodreads", url: "https://goodreads.com/book/1" },
  ];
  it("keeps only links Claude actually saw in search results", () => {
    const out = checkSources(
      [
        { title: "Kirkus review", url: "https://kirkusreviews.com/book-reviews/x" },
        { title: "Made up", url: "https://not-real.example/review" },
        { title: "Bad", url: "javascript:alert(1)" },
      ],
      searched,
    );
    expect(out).toEqual([{ title: "Kirkus review", url: "https://kirkusreviews.com/book-reviews/x" }]);
  });
  it("falls back to search results when none of the claimed links check out", () => {
    expect(checkSources([{ title: "x", url: "https://nope.example" }], searched).map((s) => s.title)).toEqual(["Kirkus", "Goodreads"]);
  });
});
