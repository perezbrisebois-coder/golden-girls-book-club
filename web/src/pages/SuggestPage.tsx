import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { collection, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import { BookCard } from "../components/BookCard";
import { Field } from "../components/Field";
import { ReviewLoading, ReviewSummary, ReviewUnavailable } from "../components/ReviewSummary";
import { mapsLink } from "../format";
import type { BookCandidate, BookReview, PlaceInfo, PlaceReview, Proposal } from "../types";

const proposalsQuery = query(collection(firestore, "proposals"), orderBy("createdAt", "desc"));

type Kind = "book" | "place";

export function SuggestPage() {
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get("kind") === "place" ? "place" : "book";
  const [adding, setAdding] = useState(false);
  const { data: proposals, loading } = useCollection<Proposal>(proposalsQuery, "proposals");
  const list = proposals.filter((p) => p.kind === kind);
  const existing = useMemo(() => new Map(proposals.map((p) => [p.key, p])), [proposals]);

  function switchKind(k: Kind) {
    setAdding(false);
    setParams(k === "place" ? { kind: "place" } : {}, { replace: true });
  }

  return (
    <section>
      <h1 className="page-title">Suggest</h1>
      <DecoDivider />
      <div className="segmented" role="tablist" aria-label="What to suggest">
        <button type="button" role="tab" aria-selected={kind === "book"} className="segment" onClick={() => switchKind("book")}>
          Books
        </button>
        <button type="button" role="tab" aria-selected={kind === "place"} className="segment" onClick={() => switchKind("place")}>
          Places
        </button>
      </div>

      <div role="tabpanel">
        {adding ? (
          kind === "book" ? (
            <BookFlow existing={existing} onDone={() => setAdding(false)} />
          ) : (
            <PlaceFlow existing={existing} onDone={() => setAdding(false)} />
          )
        ) : (
          <div className="center">
            <button type="button" className="btn btn-primary btn-large" onClick={() => setAdding(true)}>
              {kind === "book" ? "+ Suggest a book" : "+ Suggest a place"}
            </button>
          </div>
        )}

        <h2 className="section-title">{kind === "book" ? "Suggested books" : "Suggested places"}</h2>
        {loading ? (
          <p className="loading">Loading…</p>
        ) : list.length === 0 ? (
          <p className="muted">Nothing suggested yet. Be the first!</p>
        ) : (
          <ul className="proposal-list">
            {list.map((p) => (
              <li key={p.id}>
                <ProposalCard proposal={p} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Books

function BookFlow({ existing, onDone }: { existing: Map<string, Proposal>; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<BookCandidate[] | null>(null);
  const [searchedFor, setSearchedFor] = useState("");
  const [chosen, setChosen] = useState<BookCandidate | null>(null);
  const [review, setReview] = useState<BookReview | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "done" | "unavailable">("idle");
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  async function search(e: FormEvent) {
    e.preventDefault();
    setError("");
    setChosen(null);
    if (q.trim().length < 2) return setError("Please type a title, an author, or both.");
    setSearching(true);
    try {
      const res = await api.searchBooks({ query: q });
      setResults(res.candidates);
      setSearchedFor(res.searchedFor);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSearching(false);
    }
  }

  async function choose(b: BookCandidate) {
    setChosen(b);
    setNote("");
    setReview(null);
    setReviewState("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function lookUp() {
    if (!chosen) return;
    setReviewState("loading");
    try {
      const res = await api.getBookReview({ book: { title: chosen.title, authors: chosen.authors, year: chosen.year } });
      setReview(res.review);
      setReviewState(res.review ? "done" : "unavailable");
    } catch {
      setReviewState("unavailable");
    }
  }

  async function post() {
    if (!chosen) return;
    setPosting(true);
    setError("");
    try {
      await api.proposeBook({ book: chosen, note });
      toast("Your book suggestion is posted!");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setPosting(false);
    }
  }

  if (chosen) {
    const dup = existing.get(chosen.key);
    return (
      <div className="card flow">
        <h2 className="section-title flush">Is this the book you want to recommend?</h2>
        <BookCard book={chosen}>
          {chosen.pageCount && <p className="muted">About {chosen.pageCount} pages</p>}
        </BookCard>
        <h3 className="section-label">What critics and readers say</h3>
        {reviewState === "idle" && <ReviewOffer what="this book" onLookUp={lookUp} />}
        {reviewState === "loading" && <ReviewLoading what="this book" />}
        {reviewState === "done" && review && <ReviewSummary review={review} />}
        {reviewState === "unavailable" && <ReviewUnavailable />}

        {dup ? (
          <div className="notice">
            <p>
              <strong>{dup.proposerName}</strong> already suggested this book, so it's on the list.
            </p>
          </div>
        ) : (
          <Field id="book-note" label="Why I'm recommending it (optional)">
            <textarea id="book-note" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          {!dup && (
            <button type="button" className="btn btn-primary" onClick={post} disabled={posting}>
              {posting ? "Posting…" : "Yes, recommend this book"}
            </button>
          )}
          {results && results.length > 1 && (
            <button type="button" className="btn btn-secondary" onClick={() => setChosen(null)}>
              No, show other matches
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setChosen(null);
              setResults(null);
            }}
          >
            Search again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card flow">
      <form onSubmit={search} noValidate>
        <Field id="book-q" label="Which book?" hint="Type the title, the author, or both. Spelling doesn't need to be perfect.">
          <div className="input-with-button">
            <input id="book-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} autoFocus />
            <button type="submit" className="btn btn-primary" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </Field>
      </form>
      {searching && <p className="hint">Searching the book catalogs…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {results && !searching && (
        <>
          {results.length === 0 ? (
            <p>We couldn't find that book. Try adding the author's name, or check the title.</p>
          ) : (
            <>
              {searchedFor && (
                <p className="notice">
                  We didn't find an exact match, so we searched for <strong>{searchedFor}</strong>.
                </p>
              )}
              <p className="strong">Pick the right book:</p>
              <ul className="candidate-list">
                {results.map((b, i) => (
                  <li key={b.key}>
                    <BookCard book={{ ...b, description: b.description.slice(0, 220) + (b.description.length > 220 ? "…" : "") }}>
                      {i === 0 && <p className="badge">Best match</p>}
                      {existing.has(b.key) && <p className="muted">Already suggested by {existing.get(b.key)!.proposerName}</p>}
                      <button type="button" className="btn btn-primary" onClick={() => choose(b)}>
                        This one
                      </button>
                    </BookCard>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Places

function PlaceFlow({ existing, onDone }: { existing: Map<string, Proposal>; onDone: () => void }) {
  const toast = useToast();
  const [isPrivate, setIsPrivate] = useState(false);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceInfo[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [chosen, setChosen] = useState<PlaceInfo | null>(null);
  const [review, setReview] = useState<PlaceReview | null>(null);
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "done" | "unavailable">("idle");
  const [manual, setManual] = useState({ name: "", address: "", city: "" });
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  async function search(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (q.trim().length < 3) return setError("Please type the place's name and town.");
    setSearching(true);
    setResults(null);
    try {
      const res = await api.searchPlaces({ query: q });
      setResults(res.candidates);
      setUnavailable(res.unavailable);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSearching(false);
    }
  }

  async function choose(p: PlaceInfo) {
    setChosen(p);
    setNote("");
    setReview(null);
    setReviewState("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function lookUp() {
    if (!chosen) return;
    setReviewState("loading");
    try {
      const res = await api.getPlaceReview({ place: chosen });
      setReview(res.review);
      setReviewState(res.review ? "done" : "unavailable");
    } catch {
      setReviewState("unavailable");
    }
  }

  async function post(place: Omit<PlaceInfo, "key">, priv: boolean) {
    setPosting(true);
    setError("");
    try {
      await api.proposePlace({ place, note, isPrivate: priv });
      toast("Your place suggestion is posted!");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setPosting(false);
    }
  }

  const errorBox = error && (
    <p className="error" role="alert">
      {error}
    </p>
  );
  const noteField = (
    <Field id="place-note" label="Why I'm suggesting it (optional)">
      <textarea id="place-note" className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
    </Field>
  );

  if (chosen) {
    const dup = existing.get(chosen.key);
    return (
      <div className="card flow">
        <h2 className="section-title flush">Is this the place?</h2>
        <PlaceDetails place={chosen} />
        <h3 className="section-label">What reviewers say</h3>
        {reviewState === "idle" && <ReviewOffer what="this place" onLookUp={lookUp} />}
        {reviewState === "loading" && <ReviewLoading what="this place" />}
        {reviewState === "done" && review && <ReviewSummary review={review} />}
        {reviewState === "unavailable" && <ReviewUnavailable />}
        {dup ? (
          <div className="notice">
            <p>
              <strong>{dup.proposerName}</strong> already suggested this place, so it's on the list.
            </p>
          </div>
        ) : (
          noteField
        )}
        {errorBox}
        <div className="button-row">
          {!dup && (
            <button type="button" className="btn btn-primary" onClick={() => post(chosen, false)} disabled={posting}>
              {posting ? "Posting…" : "Yes, suggest this place"}
            </button>
          )}
          {results && results.length > 1 && (
            <button type="button" className="btn btn-secondary" onClick={() => setChosen(null)}>
              No, show other matches
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setChosen(null);
              setResults(null);
            }}
          >
            Search again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card flow">
      <label className="checkbox">
        <input
          type="checkbox"
          checked={isPrivate}
          onChange={(e) => {
            setIsPrivate(e.target.checked);
            setError("");
          }}
        />
        <span>This is someone's home or a private place (no online lookup)</span>
      </label>

      {isPrivate ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!manual.name.trim() || !manual.address.trim()) return setError("Please fill in the name and address.");
            post({ ...manual, phone: "", website: "", description: "" }, true);
          }}
          noValidate
        >
          <Field id="pp-name" label="Name" hint={'For example "Rose\'s house"'}>
            <input id="pp-name" className="input" maxLength={200} value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} />
          </Field>
          <Field id="pp-address" label="Street address">
            <input
              id="pp-address"
              className="input"
              maxLength={300}
              autoComplete="street-address"
              value={manual.address}
              onChange={(e) => setManual({ ...manual, address: e.target.value })}
            />
          </Field>
          <Field id="pp-city" label="City (optional)">
            <input id="pp-city" className="input" maxLength={120} value={manual.city} onChange={(e) => setManual({ ...manual, city: e.target.value })} />
          </Field>
          {noteField}
          {errorBox}
          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={posting}>
              {posting ? "Posting…" : "Suggest this place"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onDone}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <form onSubmit={search} noValidate>
            <Field id="place-q" label="Which place?" hint={'Type the name and town, for example "Olive Garden Naperville".'}>
              <div className="input-with-button">
                <input id="place-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={200} autoFocus />
                <button type="submit" className="btn btn-primary" disabled={searching}>
                  {searching ? "Searching…" : "Search"}
                </button>
              </div>
            </Field>
          </form>
          {searching && (
            <div className="review-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <p>Searching the web for that place… This can take up to 30 seconds.</p>
            </div>
          )}
          {errorBox}
          {results && !searching && (
            <>
              {unavailable ? (
                <p className="notice">Place search isn't available right now. Please try again later.</p>
              ) : results.length === 0 ? (
                <p>We couldn't find that place. Try adding the town or street.</p>
              ) : (
                <>
                  <p className="strong">Pick the right place:</p>
                  <ul className="candidate-list">
                    {results.map((p) => (
                      <li key={p.key} className="card">
                        <PlaceDetails place={p} />
                        {existing.has(p.key) && <p className="muted">Already suggested by {existing.get(p.key)!.proposerName}</p>}
                        <button type="button" className="btn btn-primary" onClick={() => choose(p)}>
                          This one
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          <div className="button-row">
            <button type="button" className="btn btn-secondary" onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PlaceDetails({ place }: { place: PlaceInfo }) {
  const full = [place.address, place.city].filter(Boolean).join(", ");
  return (
    <div className="place-details">
      <h3 className="book-title">{place.name}</h3>
      {place.isPrivate && <p className="badge">Private home / place</p>}
      {place.description && <p className="muted">{place.description}</p>}
      <p>{full}</p>
      <div className="button-row">
        <a className="btn btn-secondary btn-small" href={mapsLink(full)} target="_blank" rel="noreferrer">
          Map (new tab)
        </a>
        {place.website && (
          <a className="btn btn-secondary btn-small" href={place.website} target="_blank" rel="noreferrer noopener">
            Website (new tab)
          </a>
        )}
      </div>
      {place.phone && (
        <p>
          Phone: <a href={`tel:${place.phone.replace(/[^\d+]/g, "")}`}>{place.phone}</a>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A posted suggestion

function ProposalCard({ proposal: p }: { proposal: Proposal }) {
  const { memberId, isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const mine = p.proposerId === memberId;
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(p.note);
  const [busy, setBusy] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const title = p.kind === "book" ? p.book!.title : p.place!.name;

  async function saveNote() {
    setBusy(true);
    try {
      await api.editProposalNote({ key: p.key, note });
      toast("Your note is updated.");
      setEditing(false);
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove(asAdmin: boolean) {
    const ok = await confirm({
      title: asAdmin && !mine ? `Remove "${title}"?` : `Withdraw your suggestion "${title}"?`,
      message: "It will be taken off the list. This can't be undone.",
      confirmLabel: asAdmin && !mine ? "Yes, remove it" : "Yes, withdraw it",
      danger: true,
    });
    if (!ok) return;
    try {
      if (mine) await api.withdrawProposal({ key: p.key });
      else await api.adminRemoveProposal({ key: p.key });
      toast(mine ? "Your suggestion was withdrawn." : "Suggestion removed.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function lookUpReviews() {
    setLookingUp(true);
    try {
      const res = await api.refreshProposalReview({ key: p.key });
      if (res.unavailable) toast("Reviews still aren't available. Please try again later.", "error");
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setLookingUp(false);
    }
  }

  const body = (
    <>
      <p className="proposer">
        Suggested by <strong>{p.proposerName}</strong>
        {p.updatedAt && <span className="muted"> (note edited)</span>}
      </p>
      {editing ? (
        <div>
          <Field id={`note-${p.id}`} label="Why I'm recommending it">
            <textarea id={`note-${p.id}`} className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="button-row">
            <button type="button" className="btn btn-primary btn-small" onClick={saveNote} disabled={busy}>
              {busy ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-small"
              onClick={() => {
                setNote(p.note);
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        p.note && <blockquote className="note">{p.note}</blockquote>
      )}

      {p.review ? (
        <details className="review-details">
          <summary>{p.kind === "book" ? "What critics and readers say" : "What reviewers say"}</summary>
          <ReviewSummary review={p.review} />
        </details>
      ) : (
        !(p.kind === "place" && p.place?.isPrivate) &&
        (lookingUp ? (
          <ReviewLoading what={p.kind === "book" ? "this book" : "this place"} />
        ) : (
          <button type="button" className="btn btn-secondary btn-small" onClick={lookUpReviews}>
            See what people say
          </button>
        ))
      )}

      {(mine || isAdmin) && !editing && (
        <div className="button-row">
          {mine && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
              {p.note ? "Edit my note" : "Add a note"}
            </button>
          )}
          {mine ? (
            <button type="button" className="btn btn-danger-outline btn-small" onClick={() => remove(false)}>
              Withdraw my suggestion
            </button>
          ) : (
            <button type="button" className="btn btn-danger-outline btn-small" onClick={() => remove(true)}>
              Remove (admin)
            </button>
          )}
        </div>
      )}
    </>
  );

  return p.kind === "book" ? (
    <BookCard book={{ ...p.book!, description: p.book!.description }}>{body}</BookCard>
  ) : (
    <div className="card">
      <PlaceDetails place={p.place!} />
      {body}
    </div>
  );
}

function ReviewOffer({ what, onLookUp }: { what: string; onLookUp: () => void }) {
  return (
    <div className="review-offer">
      <p className="muted">
        Optional: Claude can read reviews of {what} and summarize them. It takes about a minute. You can also skip this and
        post now; anyone can look up the reviews later from the list.
      </p>
      <button type="button" className="btn btn-secondary btn-small" onClick={onLookUp}>
        See what people say
      </button>
    </div>
  );
}
