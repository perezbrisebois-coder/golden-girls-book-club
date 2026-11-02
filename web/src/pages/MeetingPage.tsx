import { useState, type FormEvent } from "react";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection, useDoc } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import { BookCard } from "../components/BookCard";
import { Field } from "../components/Field";
import { authorList, formatDate, formatTime, mapsLink } from "../format";
import type { Election, Meeting, PastMeeting, Proposal } from "../types";

const meetingRef = doc(firestore, "config", "meeting");
const pastQuery = query(collection(firestore, "pastMeetings"), orderBy("date", "desc"));
const proposalsQuery = query(collection(firestore, "proposals"), orderBy("createdAt", "desc"));
const recentVotesQuery = query(collection(firestore, "elections"), orderBy("createdAt", "desc"), limit(12));

export function MeetingPage() {
  const { isAdmin } = useSession();
  const { data: meeting, loading } = useDoc<Meeting>(meetingRef, "meeting");
  const { data: past } = useCollection<PastMeeting>(pastQuery, "past");
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function archive() {
    const ok = await confirm({
      title: "Move this meeting to Past Meetings?",
      message: "Do this after the meeting has happened. The date and book will be cleared so you can plan the next one.",
      confirmLabel: "Yes, move it",
    });
    if (!ok) return;
    try {
      await api.archiveMeeting({});
      toast("Moved to Past Meetings.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function removePast(p: PastMeeting) {
    const ok = await confirm({
      title: "Delete this past meeting?",
      message: `${formatDate(p.date)}${p.book ? `: ${p.book.title}` : ""}. This can't be undone.`,
      confirmLabel: "Yes, delete it",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePastMeeting({ id: p.id });
      toast("Deleted.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <section>
      <h1 className="page-title">Next Meeting</h1>
      <DecoDivider />

      {editing ? (
        <MeetingEditor meeting={meeting} past={past} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="card meeting-card">
            {meeting?.date ? (
              <>
                <p className="meeting-date">{formatDate(meeting.date)}</p>
                {meeting.time && <p className="meeting-time">at {formatTime(meeting.time)}</p>}
              </>
            ) : (
              <p className="meeting-date muted">Date to be decided</p>
            )}

            {(meeting?.locationName || meeting?.address) && (
              <div className="meeting-place">
                <h2 className="section-label">Where</h2>
                {meeting.locationName && <p className="strong">{meeting.locationName}</p>}
                {meeting.address && <p>{meeting.address}</p>}
                {(meeting.address || meeting.mapUrl) && (
                  <a className="btn btn-secondary" href={mapsLink(meeting.address, meeting.mapUrl)} target="_blank" rel="noreferrer">
                    Open map (new tab)
                  </a>
                )}
              </div>
            )}

            {meeting?.notes && (
              <div>
                <h2 className="section-label">Notes</h2>
                <p className="pre-line">{meeting.notes}</p>
              </div>
            )}
          </div>

          <h2 className="section-title">The Book</h2>
          {meeting?.book ? (
            <BookCard book={meeting.book} />
          ) : (
            <div className="card">
              <p className="muted">The next book hasn't been chosen yet. Propose one and vote!</p>
            </div>
          )}

          {isAdmin && (
            <div className="admin-panel">
              <h2 className="section-label">Admin</h2>
              <div className="button-row">
                <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                  Edit meeting details
                </button>
                {meeting?.date && (
                  <button type="button" className="btn btn-secondary" onClick={archive}>
                    Meeting is done: move to Past Meetings
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="section-title">Past Meetings</h2>
          <ul className="past-list">
            {past.map((p) => (
              <li key={p.id} className="past-item">
                <div>
                  <p className="strong">{p.book ? p.book.title : "No book recorded"}</p>
                  {p.book && p.book.authors.length > 0 && <p className="muted">by {authorList(p.book.authors)}</p>}
                  <p className="muted">
                    {formatDate(p.date)}
                    {p.locationName && ` · ${p.locationName}`}
                  </p>
                </div>
                {isAdmin && (
                  <button type="button" className="btn btn-danger-outline btn-small" onClick={() => removePast(p)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function MeetingEditor({ meeting, past, onDone }: { meeting: Meeting | null; past: PastMeeting[]; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    date: meeting?.date ?? "",
    time: meeting?.time ?? "",
    locationName: meeting?.locationName ?? "",
    address: meeting?.address ?? "",
    mapUrl: meeting?.mapUrl ?? "",
    notes: meeting?.notes ?? "",
    bookKey: meeting?.book?.key ?? "",
    bookYear: meeting?.book?.year ?? "",
    bookTitle: meeting?.book?.title ?? "",
    bookAuthors: authorList(meeting?.book?.authors),
    bookCover: meeting?.book?.coverUrl ?? "",
    bookDescription: meeting?.book?.description ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data: proposals } = useCollection<Proposal>(proposalsQuery, "proposals-all");
  const { data: recentVotes } = useCollection<Election>(recentVotesQuery, "elections");
  // Books already read at a past meeting aren't offered again.
  const readBefore = new Set(past.map((p) => p.book?.key).filter(Boolean));
  const books = proposals.filter((p) => p.kind === "book" && p.book && !readBefore.has(p.key));
  const places = proposals.filter((p) => p.kind === "place" && p.place);
  // Latest vote each suggestion won, e.g. "won the vote: Next book".
  const wonVote = new Map<string, string>();
  for (const v of recentVotes) {
    if (v.status === "closed" && v.results?.winner && !wonVote.has(v.results.winner)) wonVote.set(v.results.winner, v.title);
  }
  const optionLabel = (p: Proposal, main: string) => (wonVote.has(p.key) ? `★ ${main} (won the vote: ${wonVote.get(p.key)})` : main);
  // Vote winners first.
  const byWinner = (a: Proposal, b: Proposal) => Number(wonVote.has(b.key)) - Number(wonVote.has(a.key));

  function pickBook(key: string) {
    const b = books.find((p) => p.key === key)?.book;
    if (!b) return;
    setForm((f) => ({
      ...f,
      bookKey: key,
      bookYear: b.year ?? "",
      bookTitle: b.title,
      bookAuthors: authorList(b.authors),
      bookCover: b.coverUrl ?? "",
      bookDescription: b.description ?? "",
    }));
  }

  function pickPlace(key: string) {
    const p = places.find((x) => x.key === key)?.place;
    if (!p) return;
    const address = p.city && !p.address.toLowerCase().includes(p.city.toLowerCase()) ? [p.address, p.city].filter(Boolean).join(", ") : p.address;
    setForm((f) => ({ ...f, locationName: p.name, address, mapUrl: "" }));
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.updateMeeting({
        date: form.date,
        time: form.time,
        locationName: form.locationName,
        address: form.address,
        mapUrl: form.mapUrl,
        notes: form.notes,
        book: form.bookTitle.trim()
          ? {
              key: form.bookKey,
              year: form.bookYear,
              title: form.bookTitle,
              authors: form.bookAuthors.split(",").map((a) => a.trim()).filter(Boolean),
              coverUrl: form.bookCover,
              description: form.bookDescription,
            }
          : null,
      });
      toast("Meeting details saved!");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={save} noValidate>
      <h2 className="section-title">Edit meeting details</h2>
      <div className="form-grid">
        <Field id="m-date" label="Date">
          <input id="m-date" className="input" type="date" value={form.date} onChange={set("date")} />
        </Field>
        <Field id="m-time" label="Time">
          <input id="m-time" className="input" type="time" value={form.time} onChange={set("time")} />
        </Field>
      </div>
      {places.length > 0 && (
        <Field id="m-pick-place" label="Choose from the suggested places" hint="This fills in the place name and address below.">
          <select id="m-pick-place" className="input" value="" onChange={(e) => pickPlace(e.target.value)}>
            <option value="">Pick a suggested place…</option>
            {[...places].sort(byWinner).map((p) => (
              <option key={p.key} value={p.key}>
                {optionLabel(p, p.place!.name)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field id="m-place" label="Place name" hint='For example "Rose&apos;s house" or "Main Street Library"'>
        <input id="m-place" className="input" value={form.locationName} onChange={set("locationName")} />
      </Field>
      <Field id="m-address" label="Address">
        <input id="m-address" className="input" value={form.address} onChange={set("address")} autoComplete="street-address" />
      </Field>
      <Field id="m-map" label="Map link (optional)" hint="Leave empty and we'll make a Google Maps link from the address.">
        <input id="m-map" className="input" type="url" value={form.mapUrl} onChange={set("mapUrl")} placeholder="https://" />
      </Field>
      <Field id="m-notes" label="Notes (optional)">
        <textarea id="m-notes" className="input" rows={3} value={form.notes} onChange={set("notes")} />
      </Field>

      <h3 className="section-label">Book</h3>
      {books.length > 0 && (
        <Field
          id="m-pick-book"
          label="Choose from the recommended books"
          hint="The book that won the vote is marked with ★. Choosing one fills in the details below."
        >
          <select
            id="m-pick-book"
            className="input"
            value={books.some((p) => p.key === form.bookKey) ? form.bookKey : ""}
            onChange={(e) => pickBook(e.target.value)}
          >
            <option value="">{form.bookKey || !form.bookTitle ? "Pick a recommended book…" : "Typed in by hand"}</option>
            {[...books].sort(byWinner).map((p) => (
              <option key={p.key} value={p.key}>
                {optionLabel(p, `${p.book!.title} by ${authorList(p.book!.authors)}`)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <p className="hint">
        {books.length > 0 ? "Or type the book in yourself. " : "Type the book in here. "}Leave the title empty if it isn't chosen
        yet.
      </p>
      <Field id="m-title" label="Book title">
        <input
          id="m-title"
          className="input"
          value={form.bookTitle}
          onChange={(e) => setForm((f) => ({ ...f, bookTitle: e.target.value, bookKey: "", bookYear: "" }))}
        />
      </Field>
      <Field id="m-authors" label="Author(s)" hint="Separate several authors with commas.">
        <input id="m-authors" className="input" value={form.bookAuthors} onChange={set("bookAuthors")} />
      </Field>
      <Field id="m-cover" label="Cover image link (optional)">
        <input id="m-cover" className="input" type="url" value={form.bookCover} onChange={set("bookCover")} placeholder="https://" />
      </Field>
      <Field id="m-desc" label="Short description (optional)">
        <textarea id="m-desc" className="input" rows={4} value={form.bookDescription} onChange={set("bookDescription")} />
      </Field>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save meeting details"}
        </button>
      </div>
    </form>
  );
}

