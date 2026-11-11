import { logger } from "firebase-functions";

export interface BookCandidate {
  key: string; // stable de-duplication key (see bookKey)
  title: string;
  authors: string[];
  year: string;
  coverUrl: string;
  description: string;
  pageCount: number | null;
  isbn: string;
  source: "google" | "openlibrary" | "web";
  workId?: string; // Open Library work ID, e.g. OL123W
}

const TIMEOUT_MS = 8000;

/** Normalizes text for matching: lowercase, no accents/punctuation/leading article. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * De-duplication key for a book. Different editions (hardcover, paperback,
 * large print) have different ISBNs, so we match on title (without subtitle)
 * + first author's last name instead.
 */
export function bookKey(title: string, authors: string[]): string {
  const mainTitle = normalize(title.split(/[:(]/)[0]);
  const lastName = normalize(authors[0] ?? "").split(" ").pop() ?? "";
  return `book-${mainTitle}-${lastName}`.replace(/ /g, "-").slice(0, 140);
}

function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
}

function https(url: string | undefined): string {
  return url ? url.replace(/^http:/, "https:") : "";
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "GoldenGirlsBookClub/1.0" } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function searchGoogleBooks(query: string): Promise<BookCandidate[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=12&printType=books&langRestrict=en`;
  const data = (await getJson(url)) as { items?: Array<{ volumeInfo: Record<string, any> }> };
  return (data.items ?? [])
    .map(({ volumeInfo: v }) => {
      const authors: string[] = v.authors ?? [];
      const isbn = (v.industryIdentifiers ?? []).find((i: { type: string }) => i.type === "ISBN_13")?.identifier ?? "";
      const title = v.subtitle && v.title.length < 40 ? `${v.title}: ${v.subtitle}` : v.title;
      return {
        key: bookKey(v.title ?? "", authors),
        title: title ?? "",
        authors,
        year: (v.publishedDate ?? "").slice(0, 4),
        coverUrl: https(v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail).replace("&edge=curl", ""),
        description: stripHtml(v.description ?? "").slice(0, 1500),
        pageCount: typeof v.pageCount === "number" && v.pageCount > 0 ? v.pageCount : null,
        isbn,
        source: "google" as const,
      };
    })
    .filter((b) => b.title && b.authors.length > 0);
}

export async function searchOpenLibrary(query: string): Promise<BookCandidate[]> {
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median`;
  const data = (await getJson(url)) as { docs?: Array<Record<string, any>> };
  return (data.docs ?? [])
    .map((d) => {
      const authors: string[] = d.author_name ?? [];
      return {
        key: bookKey(d.title ?? "", authors),
        title: d.title ?? "",
        authors: authors.slice(0, 3),
        year: d.first_publish_year ? String(d.first_publish_year) : "",
        coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
        description: "",
        pageCount: d.number_of_pages_median ?? null,
        isbn: (d.isbn ?? []).find((i: string) => i.length === 13) ?? "",
        source: "openlibrary" as const,
        workId: typeof d.key === "string" ? d.key.replace("/works/", "") : "",
      };
    })
    .filter((b) => b.title && b.authors.length > 0);
}

/** Open Library search results have no description; fetch it from the work record. */
async function openLibraryDescription(workId: string): Promise<string> {
  if (!/^OL\d+W$/.test(workId)) return "";
  try {
    const w = (await getJson(`https://openlibrary.org/works/${workId}.json`)) as { description?: string | { value?: string } };
    const d = typeof w.description === "string" ? w.description : (w.description?.value ?? "");
    // Drop Open Library's trailing source notes and markdown links.
    return d.split(/\n-{3,}|\(\[source\]/i)[0].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim().slice(0, 1500);
  } catch {
    return "";
  }
}

/**
 * Looks a book up by whatever the member typed (title, author, or both; spelling
 * mistakes are fine). Merges editions of the same book and keeps the most
 * complete one. Google Books first; Open Library fills gaps or takes over if
 * Google is unavailable.
 */
export async function searchBooks(query: string): Promise<BookCandidate[]> {
  const [google, openLib] = await Promise.allSettled([searchGoogleBooks(query), searchOpenLibrary(query)]);
  if (google.status === "rejected") logger.warn("Google Books failed", { error: String(google.reason) });
  if (openLib.status === "rejected") logger.warn("Open Library failed", { error: String(openLib.reason) });
  const JUNK = /^(summary|study guide|workbook|analysis|sparknotes|cliffsnotes)\b|\b(summary|study guide|workbook) (of|for|:)/i;
  const all = [
    ...(google.status === "fulfilled" ? google.value : []),
    ...(openLib.status === "fulfilled" ? openLib.value : []),
  ].filter((b) => !JUNK.test(b.title));
  if (google.status === "rejected" && openLib.status === "rejected") throw new Error("Book lookup services unavailable");

  const byKey = new Map<string, BookCandidate>();
  const order: string[] = [];
  for (const b of all) {
    const existing = byKey.get(b.key);
    if (!existing) {
      byKey.set(b.key, b);
      order.push(b.key);
      continue;
    }
    // Fill missing details from other editions/sources.
    byKey.set(b.key, {
      ...existing,
      coverUrl: existing.coverUrl || b.coverUrl,
      description: existing.description.length >= b.description.length ? existing.description : b.description,
      pageCount: existing.pageCount ?? b.pageCount,
      year: existing.year && b.year ? String(Math.min(Number(existing.year), Number(b.year)) || existing.year) : existing.year || b.year,
      isbn: existing.isbn || b.isbn,
    });
  }
  const results = order.slice(0, 6).map((k) => byKey.get(k)!);
  await Promise.all(
    results.slice(0, 3).map(async (b) => {
      if (!b.description && b.workId) b.description = await openLibraryDescription(b.workId);
    }),
  );
  return results.map(({ workId: _omit, ...b }) => b);
}
