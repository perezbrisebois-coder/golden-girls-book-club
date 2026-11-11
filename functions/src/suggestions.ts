import { onCall, HttpsError, type CallableRequest } from "firebase-functions/https";
import { FieldValue } from "firebase-admin/firestore";
import { db, optionalUrl, requireAdmin, requireMember, sha256, str } from "./lib/common";
import { bookKey, normalize, searchBooks as lookupBooks, type BookCandidate } from "./lib/bookSources";
import { useAiQuota } from "./lib/aiQuota";
import {
  ANTHROPIC_API_KEY,
  ProviderUnavailableError,
  withProviders,
  type BookReview,
  type PlaceCandidate,
  type PlaceReview,
} from "./reviews";

const DAY_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_MS = 30 * DAY_MS; // places
/** Book searches are kept briefly so newly published books show up quickly. */
const BOOK_SEARCH_CACHE_MS = 1 * DAY_MS;
const REVIEW_CACHE_MS = 90 * DAY_MS;
/** AI calls with web search can take a while. */
const AI_OPTS = { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 240, memory: "512MiB" as const };

const proposals = () => db().collection("proposals");

export function placeKey(name: string, address: string): string {
  return `place-${normalize(name)}-${normalize(address)}`.replace(/ /g, "-").slice(0, 140);
}

// ---------------------------------------------------------------------------
// Caches (Firestore, closed to clients)

async function cached<T>(collection: string, id: string, maxAgeMs: number): Promise<T | null> {
  const snap = await db().collection(collection).doc(id).get();
  if (!snap.exists || Date.now() - (snap.get("createdAt") as number) > maxAgeMs) return null;
  return snap.get("value") as T;
}

async function store(collection: string, id: string, value: unknown, extra: Record<string, unknown> = {}) {
  await db().collection(collection).doc(id).set({ value, createdAt: Date.now(), ...extra });
}

// ---------------------------------------------------------------------------
// Books

type BookSearchResult = { candidates: BookCandidate[]; searchedFor: string };

/** Find matching books for whatever the member typed. Fixes spelling with AI if nothing is found. */
export const searchBooks = onCall(AI_OPTS, async (req): Promise<BookSearchResult> => {
  const { memberId } = await requireMember(req);
  const query = str(req.data?.query, "a title or author", { max: 200, required: true });
  if (query.length < 2) throw new HttpsError("invalid-argument", "Please type a bit more of the title or author.");
  const cacheId = sha256(normalize(query));
  const hit = await cached<BookSearchResult>("bookSearchCache", cacheId, BOOK_SEARCH_CACHE_MS);
  if (hit) return hit;

  let result: BookSearchResult;
  try {
    result = { candidates: await lookupBooks(query), searchedFor: "" };
    if (result.candidates.length === 0) {
      await useAiQuota(memberId);
      const suggestions = await withProviders((p) => p.suggestBookSearches(query)).catch(() => [] as string[]);
      for (const s of suggestions) {
        const candidates = await lookupBooks(s);
        if (candidates.length) {
          result = { candidates, searchedFor: s };
          break;
        }
      }
    }
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("unavailable", "The book catalog isn't answering right now. Please try again in a few minutes.");
  }
  if (result.candidates.length) await store("bookSearchCache", cacheId, result, { query });
  return result;
});

type WebBookSearchResult = { candidates: BookCandidate[]; unavailable: boolean };

/**
 * "Search the whole internet": AI web search for any real book, including
 * brand-new and upcoming titles the catalogs don't list yet.
 */
export const searchBooksWeb = onCall(AI_OPTS, async (req): Promise<WebBookSearchResult> => {
  const { memberId } = await requireMember(req);
  const query = str(req.data?.query, "a title or author", { max: 200, required: true });
  if (query.length < 2) throw new HttpsError("invalid-argument", "Please type a bit more of the title or author.");
  const cacheId = sha256(normalize(query));
  const hit = await cached<WebBookSearchResult>("bookWebSearchCache", cacheId, BOOK_SEARCH_CACHE_MS);
  if (hit) return hit;
  await useAiQuota(memberId);
  try {
    const found = await withProviders((p) => p.findBooks(query));
    const seen = new Set<string>();
    const candidates: BookCandidate[] = [];
    for (const b of found) {
      const key = bookKey(b.title, b.authors);
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        key,
        title: b.title.slice(0, 300),
        authors: b.authors.slice(0, 5).map((a) => a.slice(0, 200)),
        year: /^\d{4}$/.test(b.year) ? b.year : "",
        coverUrl: "",
        description: b.description.slice(0, 1500),
        pageCount: null,
        isbn: "",
        source: "web",
      });
    }
    const result = { candidates, unavailable: false };
    if (candidates.length) await store("bookWebSearchCache", cacheId, result, { query });
    return result;
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return { candidates: [], unavailable: true };
    throw err;
  }
});

function parseBookQuery(raw: unknown) {
  const b = (raw ?? {}) as Record<string, unknown>;
  const title = str(b.title, "the book title", { max: 300, required: true });
  const authors = Array.isArray(b.authors)
    ? b.authors.slice(0, 5).map((a) => str(a, "author", { max: 200 })).filter(Boolean)
    : [];
  return { title, authors, year: str(b.year, "year", { max: 10 }) };
}

type ReviewResult<T> = { review: T | null; unavailable: boolean };

async function getReview<T>(key: string, memberId: string, produce: () => Promise<T>): Promise<ReviewResult<T>> {
  const hit = await cached<T>("reviewCache", key, REVIEW_CACHE_MS);
  if (hit) return { review: hit, unavailable: false };
  await useAiQuota(memberId);
  try {
    const review = await produce();
    await store("reviewCache", key, review);
    return { review, unavailable: false };
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return { review: null, unavailable: true };
    throw err;
  }
}

/** AI summary of how a book was received (cached). Returns unavailable:true instead of failing. */
export const getBookReview = onCall(AI_OPTS, async (req): Promise<ReviewResult<BookReview>> => {
  const { memberId } = await requireMember(req);
  const book = parseBookQuery(req.data?.book);
  return getReview(bookKey(book.title, book.authors), memberId, () => withProviders((p) => p.summarizeBook(book)));
});

// ---------------------------------------------------------------------------
// Places

function parsePlace(raw: unknown, requireCity = true): PlaceCandidate {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    name: str(p.name, "the place name", { max: 200, required: true }),
    address: str(p.address, "the address", { max: 300, required: true }),
    city: str(p.city, "the city", { max: 120, required: requireCity }),
    phone: str(p.phone, "phone", { max: 40 }),
    website: optionalUrl(p.website, "website"),
    description: str(p.description, "description", { max: 200 }),
  };
}

type PlaceSearchResult = { candidates: Array<PlaceCandidate & { key: string }>; unavailable: boolean };

/** AI web search for a restaurant or other venue. */
export const searchPlaces = onCall(AI_OPTS, async (req): Promise<PlaceSearchResult> => {
  const { memberId } = await requireMember(req);
  const query = str(req.data?.query, "a place name and town", { max: 200, required: true });
  const cacheId = sha256(normalize(query));
  const hit = await cached<PlaceSearchResult>("placeSearchCache", cacheId, SEARCH_CACHE_MS);
  if (hit) return hit;
  await useAiQuota(memberId);
  try {
    const found = await withProviders((p) => p.findPlaces(query));
    const result = { candidates: found.map((p) => ({ ...p, key: placeKey(p.name, p.address) })), unavailable: false };
    if (result.candidates.length) await store("placeSearchCache", cacheId, result, { query });
    return result;
  } catch (err) {
    if (err instanceof ProviderUnavailableError) return { candidates: [], unavailable: true };
    throw err;
  }
});

export const getPlaceReview = onCall(AI_OPTS, async (req): Promise<ReviewResult<PlaceReview>> => {
  const { memberId } = await requireMember(req);
  const place = parsePlace(req.data?.place);
  return getReview(placeKey(place.name, place.address), memberId, () => withProviders((p) => p.summarizePlace(place)));
});

// ---------------------------------------------------------------------------
// Posting and managing suggestions

async function assertNotOnOpenBallot(key: string) {
  const open = await db().collection("elections").where("status", "==", "open").where("candidateKeys", "array-contains", key).limit(1).get();
  if (!open.empty) {
    throw new HttpsError("failed-precondition", "This suggestion is on a ballot that's open for voting. Wait until the vote closes.");
  }
}

async function createProposal(key: string, data: Record<string, unknown>, what: string) {
  await db().runTransaction(async (tx) => {
    const existing = await tx.get(proposals().doc(key));
    if (existing.exists) {
      throw new HttpsError("already-exists", `${existing.get("proposerName")} already suggested this ${what}.`);
    }
    tx.create(proposals().doc(key), { ...data, key, createdAt: FieldValue.serverTimestamp() });
  });
}

/** Member confirmed "Yes, this is the book". Review comes from our cache, never from the client. */
export const proposeBook = onCall(async (req) => {
  const { memberId, name } = await requireMember(req);
  const b = (req.data?.book ?? {}) as Record<string, unknown>;
  const { title, authors, year } = parseBookQuery(b);
  const key = bookKey(title, authors);
  const pageCount = typeof b.pageCount === "number" && b.pageCount > 0 && b.pageCount < 10000 ? Math.round(b.pageCount) : null;
  const review = await cached<BookReview>("reviewCache", key, REVIEW_CACHE_MS);
  await createProposal(
    key,
    {
      kind: "book",
      book: {
        key,
        title,
        authors,
        year,
        coverUrl: optionalUrl(b.coverUrl, "cover"),
        description: str(b.description, "description", { max: 5000 }),
        pageCount,
        isbn: str(b.isbn, "ISBN", { max: 20 }),
      },
      review: review ?? null,
      proposerId: memberId,
      proposerName: name,
      note: str(req.data?.note, "your note", { max: 1000 }),
    },
    "book",
  );
  return { key };
});

/** Member confirmed "Yes, this is the place". Private places (someone's home) skip the AI lookup. */
export const proposePlace = onCall(async (req) => {
  const { memberId, name } = await requireMember(req);
  const isPrivate = req.data?.isPrivate === true;
  const place = parsePlace(req.data?.place, !isPrivate);
  const key = placeKey(place.name, place.address);
  const review = isPrivate ? null : await cached<PlaceReview>("reviewCache", key, REVIEW_CACHE_MS);
  await createProposal(
    key,
    {
      kind: "place",
      place: { ...place, key, isPrivate },
      review: review ?? null,
      proposerId: memberId,
      proposerName: name,
      note: str(req.data?.note, "your note", { max: 1000 }),
    },
    "place",
  );
  return { key };
});

async function loadOwn(req: CallableRequest) {
  const { memberId } = await requireMember(req);
  const key = str(req.data?.key, "suggestion", { max: 200, required: true });
  const snap = await proposals().doc(key).get();
  if (!snap.exists) throw new HttpsError("not-found", "That suggestion no longer exists.");
  if (snap.get("proposerId") !== memberId) {
    throw new HttpsError("permission-denied", "Only the person who made this suggestion can change it.");
  }
  return snap;
}

export const editProposalNote = onCall(async (req) => {
  const snap = await loadOwn(req);
  await snap.ref.update({ note: str(req.data?.note, "your note", { max: 1000 }), updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const withdrawProposal = onCall(async (req) => {
  const snap = await loadOwn(req);
  await assertNotOnOpenBallot(snap.id);
  await snap.ref.delete();
  return { ok: true };
});

export const adminRemoveProposal = onCall(async (req) => {
  requireAdmin(req);
  const key = str(req.data?.key, "suggestion", { max: 200, required: true });
  await assertNotOnOpenBallot(key);
  await proposals().doc(key).delete();
  return { ok: true };
});

/** Anyone can retry the AI summary for a posted suggestion that has none (e.g. the AI was down). */
export const refreshProposalReview = onCall(AI_OPTS, async (req) => {
  const { memberId } = await requireMember(req);
  const key = str(req.data?.key, "suggestion", { max: 200, required: true });
  const snap = await proposals().doc(key).get();
  if (!snap.exists) throw new HttpsError("not-found", "That suggestion no longer exists.");
  if (snap.get("review")) return { ok: true, unavailable: false };
  if (snap.get("kind") === "place" && snap.get("place.isPrivate")) {
    throw new HttpsError("failed-precondition", "Private places don't have reviews.");
  }
  const result =
    snap.get("kind") === "book"
      ? await getReview(key, memberId, () => withProviders((p) => p.summarizeBook(snap.get("book"))))
      : await getReview(key, memberId, () => withProviders((p) => p.summarizePlace(snap.get("place"))));
  if (result.review) await snap.ref.update({ review: result.review });
  return { ok: true, unavailable: result.unavailable };
});
