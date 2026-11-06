import { useMemo, useState, type FormEvent } from "react";
import { collection, doc, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection, useDoc } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import { Field } from "../components/Field";
import { formatDate, formatTime } from "../format";
import { todayIso } from "../dates";
import type { Meeting, Potluck, PotluckItem } from "../types";

const potlucksQuery = query(collection(firestore, "potlucks"), orderBy("date", "desc"));
const meetingRef = doc(firestore, "config", "meeting");

/** Same list as the server (functions/src/potluck.ts). */
const CATEGORIES = ["Appetizer", "Main dish", "Side", "Salad", "Dessert", "Drinks", "Supplies", "Other"];
/** The basics a potluck usually needs; shown as "nobody's bringing … yet". */
const ESSENTIALS = ["Main dish", "Side", "Salad", "Dessert", "Drinks"];

export function PotluckPage() {
  const { isAdmin } = useSession();
  const { data: potlucks, loading } = useCollection<Potluck>(potlucksQuery, "potlucks");
  const [starting, setStarting] = useState(false);

  if (loading) return <p className="loading">Loading…</p>;

  const today = todayIso();
  // Upcoming potlucks soonest first; anything past (or closed and past) goes under "Earlier potlucks".
  const upcoming = potlucks.filter((p) => p.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const earlier = potlucks.filter((p) => p.date < today);

  return (
    <section>
      <h1 className="page-title">Potluck</h1>
      <DecoDivider />

      {isAdmin &&
        (starting ? (
          <StartPotluckForm existingDates={potlucks.map((p) => p.date)} onDone={() => setStarting(false)} />
        ) : (
          <div className="button-row center-row">
            <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}>
              + Start a potluck
            </button>
          </div>
        ))}

      {upcoming.length === 0 && !starting && (
        <div className="card stack-gap">
          <p>
            No potluck is planned right now.{" "}
            {isAdmin ? "Start one for the next meeting." : "The admin will start one when there's a potluck meeting."}
          </p>
        </div>
      )}

      {upcoming.map((p) => (
        <PotluckCard key={p.id} potluck={p} />
      ))}

      {earlier.length > 0 && (
        <details className="past-votes">
          <summary>Earlier potlucks ({earlier.length})</summary>
          {earlier.map((p) => (
            <PotluckCard key={p.id} potluck={p} past />
          ))}
        </details>
      )}
    </section>
  );
}

function PotluckCard({ potluck, past = false }: { potluck: Potluck; past?: boolean }) {
  const { isAdmin, memberId } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const itemsQuery = useMemo(
    () => query(collection(firestore, "potlucks", potluck.id, "items"), orderBy("createdAt")),
    [potluck.id],
  );
  const { data: items } = useCollection<PotluckItem>(itemsQuery, `potluck-items-${potluck.id}`);
  const open = potluck.status === "open" && !past;
  const mine = items.filter((i) => i.memberId === memberId);
  const byCategory = CATEGORIES.map((c) => ({ category: c, items: items.filter((i) => i.category === c) })).filter(
    (g) => g.items.length > 0,
  );
  const missing = ESSENTIALS.filter((c) => !items.some((i) => i.category === c));
  const people = new Set(items.map((i) => i.memberId)).size;

  async function setStatus(status: "open" | "closed") {
    try {
      await api.updatePotluck({ id: potluck.id, status });
      toast(status === "closed" ? "Sign-ups are closed." : "Sign-ups are open again.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this potluck?",
      message: "The potluck and everything people signed up to bring will be deleted. This can't be undone.",
      confirmLabel: "Delete potluck",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePotluck({ id: potluck.id });
      toast("The potluck was deleted.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  async function removeItem(item: PotluckItem) {
    const ok = await confirm({
      title: item.memberId === memberId ? `Remove "${item.dish}"?` : `Remove ${item.name}'s "${item.dish}"?`,
      message: "It will be taken off the list.",
      confirmLabel: "Yes, remove it",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deletePotluckItem({ potluckId: potluck.id, id: item.id });
      toast("Removed from the list.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  return (
    <article className="card election">
      <header className="election-header">
        <h2 className="section-title flush">Potluck for {formatDate(potluck.date)}</h2>
        <span className="badge">{open ? "Sign-ups open" : "Sign-ups closed"}</span>
      </header>
      <MeetingLine date={potluck.date} />
      {potluck.notes && <p className="pre-line">{potluck.notes}</p>}

      {open && (
        <div className="how-to-vote">
          <h3 className="how-to-vote-title">What are you bringing?</h3>
          {mine.length > 0 && (
            <ul className="potluck-mine">
              {mine.map((i) => (
                <MyItem key={i.id} potluckId={potluck.id} item={i} onRemove={() => removeItem(i)} />
              ))}
            </ul>
          )}
          {mine.length < 5 && <AddItemForm potluckId={potluck.id} first={mine.length === 0} />}
        </div>
      )}

      <div>
        <h3 className="section-label">
          What's coming so far: {items.length} {items.length === 1 ? "item" : "items"} from {people}{" "}
          {people === 1 ? "person" : "people"}
        </h3>
        {open && items.length > 0 && missing.length > 0 && (
          <p className="notice">
            Nobody has signed up for <strong>{missing.join(", ")}</strong> yet.
          </p>
        )}
        {items.length === 0 ? (
          <p className="muted">Nobody has signed up yet.{open ? " Be the first!" : ""}</p>
        ) : (
          <div className="potluck-groups">
            {byCategory.map((g) => (
              <section key={g.category} className="potluck-group">
                <h4 className="potluck-category">
                  {g.category} <span className="muted">({g.items.length})</span>
                </h4>
                <ul className="potluck-items">
                  {g.items.map((i) => (
                    <li key={i.id}>
                      <span className="potluck-dish">{i.dish}</span> <span className="muted">· {i.name}</span>
                      {i.note && <span className="potluck-note"> · {i.note}</span>}
                      {isAdmin && i.memberId !== memberId && (
                        <button type="button" className="btn-link potluck-remove" onClick={() => removeItem(i)}>
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="admin-panel">
          <h3 className="section-label">Admin</h3>
          <div className="button-row">
            {!past &&
              (potluck.status === "open" ? (
                <button type="button" className="btn btn-secondary" onClick={() => setStatus("closed")}>
                  Close sign-ups
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => setStatus("open")}>
                  Reopen sign-ups
                </button>
              ))}
            <EditNotesButton potluck={potluck} />
            <button type="button" className="btn btn-danger-outline" onClick={remove}>
              Delete potluck
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/** "At Kristen's house, 7:00 PM" when the potluck is for the next meeting. */
function MeetingLine({ date }: { date: string }) {
  const { data: meeting } = useDoc<Meeting>(meetingRef, "meeting");
  if (!meeting || meeting.date !== date) return null;
  const parts = [meeting.time && formatTime(meeting.time), meeting.locationName].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="muted">Next meeting: {parts.join(" · ")}</p>;
}

function ItemFields({
  id,
  dish,
  setDish,
  category,
  setCategory,
  note,
  setNote,
}: {
  id: string;
  dish: string;
  setDish: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  return (
    <>
      <div className="form-grid">
        <Field id={`${id}-dish`} label="What I'm bringing" hint='For example "Lemon bars" or "Sparkling water".'>
          <input id={`${id}-dish`} className="input" value={dish} maxLength={120} onChange={(e) => setDish(e.target.value)} />
        </Field>
        <Field id={`${id}-cat`} label="Type">
          <select id={`${id}-cat`} className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose…</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={`${id}-note`} label="Note (optional)" hint='For example "gluten-free" or "serves 8".'>
        <input id={`${id}-note`} className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </>
  );
}

function AddItemForm({ potluckId, first }: { potluckId: string; first: boolean }) {
  const toast = useToast();
  const [dish, setDish] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  // The form is always open until you've signed up for something; after that it's behind "+ Add something else".
  const showForm = first || expanded;
  const setShowForm = setExpanded;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dish.trim()) return setError("Please say what you're bringing.");
    if (!category) return setError("Please choose a type.");
    setBusy(true);
    setError("");
    try {
      await api.addPotluckItem({ potluckId, dish, category, note });
      toast("You're on the list. Thank you!");
      setDish("");
      setCategory("");
      setNote("");
      setShowForm(false);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!showForm) {
    return (
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setShowForm(true)}>
        + Add something else
      </button>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      <ItemFields id={`add-${potluckId}`} {...{ dish, setDish, category, setCategory, note, setNote }} />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row tight">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Adding…" : "Add to the list"}
        </button>
        {!first && (
          <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function MyItem({ potluckId, item, onRemove }: { potluckId: string; item: PotluckItem; onRemove: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [dish, setDish] = useState(item.dish);
  const [category, setCategory] = useState(item.category);
  const [note, setNote] = useState(item.note);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dish.trim() || !category) return;
    setBusy(true);
    try {
      await api.editPotluckItem({ potluckId, id: item.id, dish, category, note });
      toast("Saved.");
      setEditing(false);
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <li className="potluck-mine-item">
        <form onSubmit={save} noValidate>
          <ItemFields id={`edit-${item.id}`} {...{ dish, setDish, category, setCategory, note, setNote }} />
          <div className="button-row tight">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="potluck-mine-item">
      <span>
        <strong>{item.dish}</strong> <span className="muted">({item.category})</span>
        {item.note && <span className="muted"> · {item.note}</span>}
      </span>
      <span className="button-row tight">
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className="btn btn-danger-outline btn-small" onClick={onRemove}>
          Remove
        </button>
      </span>
    </li>
  );
}

function EditNotesButton({ potluck }: { potluck: Potluck }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(potluck.notes);
  if (!editing) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
        Edit notes
      </button>
    );
  }
  async function save() {
    try {
      await api.updatePotluck({ id: potluck.id, notes });
      toast("Notes saved.");
      setEditing(false);
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }
  return (
    <div className="potluck-notes-edit">
      <label htmlFor={`notes-${potluck.id}`} className="visually-hidden">
        Potluck notes
      </label>
      <textarea id={`notes-${potluck.id}`} className="input" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="button-row tight">
        <button type="button" className="btn btn-primary btn-small" onClick={save}>
          Save notes
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function StartPotluckForm({ existingDates, onDone }: { existingDates: string[]; onDone: () => void }) {
  const toast = useToast();
  const { data: meeting } = useDoc<Meeting>(meetingRef, "meeting");
  const suggested = meeting?.date && meeting.date >= todayIso() && !existingDates.includes(meeting.date) ? meeting.date : "";
  const [date, setDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const value = date ?? suggested;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) return setError("Please choose the meeting date.");
    setBusy(true);
    setError("");
    try {
      await api.openPotluck({ date: value, notes });
      toast("The potluck is open for sign-ups!");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form className="card flow" onSubmit={submit} noValidate>
      <h2 className="section-title flush">Start a potluck</h2>
      <Field id="pl-date" label="Meeting date" hint={suggested ? "Filled in with the next meeting's date." : undefined}>
        <input id="pl-date" className="input" type="date" min={todayIso()} value={value} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field id="pl-notes" label="Notes for members (optional)" hint='For example "Dinner at 7. Please bring serving spoons!"'>
        <textarea id="pl-notes" className="input" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Starting…" : "Start the potluck"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
