import { useState, type FormEvent } from "react";
import { api, friendlyError } from "../api";
import { useSession } from "../session";
import { DecoDivider, DecoFan } from "../components/Deco";
import { usingEmulators } from "../firebase";

export function PasswordPage() {
  const { refresh, user } = useSession();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password.trim()) return setError("Please enter the club password.");
    setBusy(true);
    setError("");
    try {
      await api.enterPassword({ password });
      await refresh();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <main className="entry">
      <div className="entry-card">
        <DecoFan size={120} />
        <h1 className="display-title">
          The Golden Girls
          <span>Book Club</span>
        </h1>
        <DecoDivider />
        <form onSubmit={submit} noValidate>
          <label htmlFor="pw" className="label">
            Club password
          </label>
          <p className="hint" id="pw-hint">
            Ask a club member if you don't know it.
          </p>
          {usingEmulators && (
            <p className="notice">
              <strong>Test mode:</strong> use <code>member</code> or <code>admin</code>. The real passwords only work on
              the live site.
            </p>
          )}
          <div className="input-with-button">
            <input
              id="pw"
              className="input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-describedby="pw-hint pw-error"
              aria-invalid={!!error}
              autoFocus
            />
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setShow((s) => !s)}>
              {show ? "Hide" : "Show"}
            </button>
          </div>
          {error && (
            <p className="error" id="pw-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !user}>
            {busy ? "Checking…" : "Enter"}
          </button>
        </form>
      </div>
    </main>
  );
}
