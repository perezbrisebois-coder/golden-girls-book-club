import { useMemo, useState, type FormEvent } from "react";
import { collection, orderBy, query } from "firebase/firestore";
import { api, friendlyError } from "../api";
import { firestore } from "../firebase";
import { useCollection } from "../hooks";
import { useSession } from "../session";
import { useToast } from "../components/Feedback";
import { DecoDivider, DecoFan } from "../components/Deco";
import type { Member } from "../types";

const membersQuery = query(collection(firestore, "members"), orderBy("nameKey"));
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
const cleanPin = (v: string) => v.replace(/\D/g, "").slice(0, 4);
/** Above this many members, show a search box over the name list. */
const SEARCH_FROM = 12;

/**
 * Step 2 of signing in. Returning members tap their name from the club list
 * (so a spelling slip can never create a second profile), then type their PIN.
 * New people use "I'm new here" to type their name and make up a PIN.
 */
export function WhoAreYouPage() {
  const { refresh, leave } = useSession();
  const toast = useToast();
  const { data: members, loading } = useCollection<Member>(membersQuery, "members");

  const [mode, setMode] = useState<"pick" | "new">("pick");
  const [selected, setSelected] = useState<Member | null>(null);
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nobody has joined yet: the first person goes straight to "I'm new".
  const effectiveMode = !loading && members.length === 0 ? "new" : mode;
  const choosingPin = effectiveMode === "new" || (selected !== null && !selected.hasPin);

  const shown = useMemo(() => {
    const f = nameKey(filter);
    return f ? members.filter((m) => nameKey(m.name).includes(f)) : members;
  }, [members, filter]);

  function reset(nextMode: "pick" | "new") {
    setMode(nextMode);
    setSelected(null);
    setPin("");
    setPin2("");
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    let name: string;
    if (effectiveMode === "new") {
      name = newName.trim().replace(/\s+/g, " ");
      if (!name) return setError("Please type your name.");
      const existing = members.find((m) => nameKey(m.name) === nameKey(name));
      if (existing) {
        return setError(
          `${existing.name} is already on the club list. If that's you, tap "I've been here before" and choose your name.`,
        );
      }
    } else {
      if (!selected) return setError("Please tap your name.");
      name = selected.name;
    }
    if (pin.length !== 4) return setError("Your PIN must be exactly 4 digits.");
    if (choosingPin && pin !== pin2) return setError("The two PINs don't match. Please type them again.");

    setBusy(true);
    try {
      const res = await api.identifyMember({ name, pin, createIfNew: effectiveMode === "new" });
      if (res.status === "notFound") {
        // Only possible if the member was removed a moment ago.
        setError("We couldn't find that name any more. Please choose again.");
        reset("pick");
        setBusy(false);
        return;
      }
      if (res.status === "created") toast(`Welcome to the club, ${res.name}!`);
      else if (res.status === "pinReset") toast(`Your new PIN is saved, ${res.name}.`);
      else toast(`Welcome back, ${res.name}!`);
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  const pinFields = (
    <>
      <label htmlFor="pin" className="label">
        {choosingPin ? "Make up a 4-digit PIN" : "Your 4-digit PIN"}
      </label>
      {choosingPin && <p className="hint">Pick one you'll remember. Nobody else, not even the admin, will ever see it.</p>}
      <input
        id="pin"
        className="input input-pin"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(cleanPin(e.target.value))}
        autoFocus={effectiveMode === "pick"}
      />
      {choosingPin && (
        <>
          <label htmlFor="pin2" className="label">
            Type the same PIN again
          </label>
          <input
            id="pin2"
            className="input input-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(cleanPin(e.target.value))}
          />
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );

  return (
    <main className="entry">
      <div className="entry-card">
        <DecoFan size={100} />
        <h1 className="display-title small">Who are you?</h1>
        <DecoDivider />

        {loading ? (
          <p className="loading">Loading…</p>
        ) : effectiveMode === "pick" && !selected ? (
          <>
            <p className="lead">Tap your name.</p>
            {members.length > SEARCH_FROM && (
              <>
                <label htmlFor="name-filter" className="label">
                  Find your name
                </label>
                <input
                  id="name-filter"
                  className="input"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Start typing…"
                  autoComplete="off"
                />
              </>
            )}
            <ul className="name-pick" aria-label="Club members">
              {shown.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="btn btn-secondary name-pick-btn"
                    onClick={() => {
                      setSelected(m);
                      setError("");
                    }}
                  >
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
            {shown.length === 0 && <p className="hint">No name matches. Check the spelling, or tap "I'm new here".</p>}
            <p className="hint center">Not on the list?</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => reset("new")}>
              I'm new here
            </button>
          </>
        ) : effectiveMode === "pick" && selected ? (
          <form onSubmit={submit} noValidate>
            <p className="lead">
              Hello, <strong>{selected.name}</strong>!
              {!selected.hasPin && " Your PIN was cleared, so please choose a new one."}
            </p>
            {pinFields}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "One moment…" : "Continue"}
            </button>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => reset("pick")}>
              That's not me, go back
            </button>
            {selected.hasPin && (
              <p className="hint center">Forgot your PIN? Ask an admin to clear it, then come back and choose a new one.</p>
            )}
          </form>
        ) : (
          <form onSubmit={submit} noValidate>
            <p className="lead">Welcome! Type your name and make up a PIN. You'll only do this once.</p>
            <label htmlFor="name" className="label">
              Your name
            </label>
            <input
              id="name"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoComplete="name"
              maxLength={40}
              autoFocus
            />
            <p className="hint">Use the name the club knows you by, e.g. "Rose" or "Rose M."</p>
            {pinFields}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "One moment…" : "Create my profile"}
            </button>
            {members.length > 0 && (
              <button type="button" className="btn btn-secondary btn-block" onClick={() => reset("pick")}>
                I've been here before
              </button>
            )}
          </form>
        )}

        <button type="button" className="btn btn-link" onClick={leave}>
          Leave (sign out of the club)
        </button>
      </div>
    </main>
  );
}
