import { useState, type FormEvent } from "react";
import { api, friendlyError } from "../api";
import { useSession } from "../session";
import { useToast } from "../components/Feedback";
import { DecoDivider, DecoFan } from "../components/Deco";

export function WhoAreYouPage() {
  const { refresh, leave } = useSession();
  const toast = useToast();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cleanPin = (v: string) => v.replace(/\D/g, "").slice(0, 4);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) return setError("Please type your name.");
    if (pin.length !== 4) return setError("Your PIN must be exactly 4 digits.");
    if (isNew && pin !== pin2) return setError("The two PINs don't match. Please type them again.");
    setBusy(true);
    try {
      const res = await api.identifyMember({ name, pin, createIfNew: isNew });
      if (res.status === "notFound") {
        setIsNew(true);
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

  return (
    <main className="entry">
      <div className="entry-card">
        <DecoFan size={100} />
        <h1 className="display-title small">Who are you?</h1>
        <DecoDivider />
        {!isNew ? (
          <p className="lead">
            Type your name and your 4-digit PIN. <strong>First time here?</strong> Type your name and make up a PIN you'll
            remember. Nobody else, not even the admin, will ever see it.
          </p>
        ) : (
          <div className="notice">
            <p>
              We don't have anyone named <strong>{name.trim()}</strong> yet.
            </p>
            <p>If you're new, type your PIN once more to create your profile. If you've used the app before, check the spelling of your name.</p>
          </div>
        )}
        <form onSubmit={submit} noValidate>
          <label htmlFor="name" className="label">
            Your name
          </label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setIsNew(false);
            }}
            autoComplete="name"
            maxLength={40}
            autoFocus
          />
          <p className="hint">Use the name the club knows you by, e.g. "Rose" or "Rose M."</p>

          <label htmlFor="pin" className="label">
            4-digit PIN
          </label>
          <input
            id="pin"
            className="input input-pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(cleanPin(e.target.value))}
          />

          {isNew && (
            <>
              <label htmlFor="pin2" className="label">
                Type your new PIN again
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
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "One moment…" : isNew ? "Yes, I'm new, create my profile" : "Continue"}
          </button>
          {isNew && (
            <button
              type="button"
              className="btn btn-secondary btn-block"
              onClick={() => {
                setIsNew(false);
                setPin2("");
              }}
            >
              No, let me fix my name
            </button>
          )}
        </form>
        <p className="hint center">
          Forgot your PIN? Ask the club admin to clear it, then come back and choose a new one.
        </p>
        <button type="button" className="btn btn-link" onClick={leave}>
          Leave (sign out of the club)
        </button>
      </div>
    </main>
  );
}
