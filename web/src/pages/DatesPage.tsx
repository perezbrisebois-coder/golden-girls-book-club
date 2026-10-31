import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, limit, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { DecoDivider } from "../components/Deco";
import { Field } from "../components/Field";
import { MonthCalendar } from "../components/MonthCalendar";
import { allowedDates, datesInMonth, monthLabel, nextMonth, todayIso } from "../dates";
import { formatDate, formatTime } from "../format";
import type { Availability, Member, Poll } from "../types";

const latestPollQuery = query(collection(firestore, "polls"), orderBy("createdAt", "desc"), limit(1));
const membersQuery = query(collection(firestore, "members"), orderBy("nameKey"));

export function DatesPage() {
  const { isAdmin } = useSession();
  const { data: polls, loading } = useCollection<Poll>(latestPollQuery, "latest-poll");
  const poll = polls[0] ?? null;
  const [startingNew, setStartingNew] = useState(false);

  if (loading) return <p className="loading">Loading…</p>;

  return (
    <section>
      <h1 className="page-title">Pick a Date</h1>
      <DecoDivider />

      {!poll || startingNew ? (
        isAdmin ? (
          <OpenPollForm onDone={() => setStartingNew(false)} onCancel={poll ? () => setStartingNew(false) : undefined} />
        ) : (
          <div className="card">
            <p>There's no date poll right now. The admin will open one when it's time to plan the next meeting.</p>
          </div>
        )
      ) : (
        <PollView poll={poll} onStartNew={() => setStartingNew(true)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

function PollView({ poll, onStartNew }: { poll: Poll; onStartNew: () => void }) {
  const { isAdmin, memberId } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const availQuery = useMemo(() => collection(firestore, "polls", poll.id, "availability"), [poll.id]);
  const { data: answers } = useCollection<Availability>(availQuery, `avail-${poll.id}`);
  const { data: members } = useCollection<Member>(membersQuery, "members");

  const allowed = useMemo(() => allowedDates(poll), [poll]);
  // Past dates stay visible in results but can no longer be tapped.
  const enabled = useMemo(() => new Set(allowed.filter((d) => d >= todayIso())), [allowed]);
  const isOpen = poll.status === "open";

  // Current member's selection (editable copy).
  const mine = answers.find((a) => a.memberId === memberId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) setSelected(new Set(mine?.dates ?? []));
  }, [mine, dirty]);

  // Tally
  const counts = useMemo(() => {
    const m = new Map<string, number>(allowed.map((d) => [d, 0]));
    for (const a of answers) for (const d of a.dates) m.set(d, (m.get(d) ?? 0) + 1);
    return m;
  }, [answers, allowed]);
  const max = Math.max(0, ...counts.values());
  const best = useMemo(() => new Set(max > 0 ? [...counts].filter(([, c]) => c === max).map(([d]) => d) : []), [counts, max]);

  const namesById = new Map(members.map((m) => [m.id, m.name]));
  const answered = new Set(answers.map((a) => a.memberId));
  const notAnswered = members.filter((m) => !answered.has(m.id));
  // Only dates someone picked appear in the grid (keeps it narrow on phones), plus all candidate dates if limited.
  const gridDates = poll.candidateDates.length > 0 ? allowed : allowed.filter((d) => (counts.get(d) ?? 0) > 0);

  function toggle(d: string) {
    setDirty(true);
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(d)) n.delete(d);
      else n.add(d);
      return n;
    });
  }

  async function save(dates: string[]) {
    setSaving(true);
    try {
      await api.setAvailability({ pollId: poll.id, dates });
      setDirty(false);
      toast(dates.length ? "Your dates are saved!" : "Got it. We've noted that none of these dates work for you.");
    } catch (e) {
      toast(friendlyError(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function noneWork() {
    const ok = await confirm({
      title: "None of these dates work?",
      message: "We'll record that you can't make any of these dates. You can change this any time while the poll is open.",
      confirmLabel: "Yes, none work for me",
    });
    if (!ok) return;
    setSelected(new Set());
    await save([]);
  }

  return (
    <>
      {isOpen ? (
        <div className="card">
          <h2 className="section-title flush">Which dates can you make in {monthLabel(poll.month)}?</h2>
          {poll.note && <p className="pre-line">{poll.note}</p>}
          <p className="hint">
            Tap every date that works for you, then press <strong>Save my dates</strong>. You can come back and change them
            until the poll closes.
            {poll.candidateDates.length > 0 && " Only the highlighted dates can be chosen."}
          </p>
          <MonthCalendar
            month={poll.month}
            enabled={enabled}
            selected={selected}
            onToggle={toggle}
            counts={counts}
            best={best}
            selectedLabel="you're available"
          />
          <p className="legend">
            <span className="legend-swatch selected" aria-hidden="true" /> Your dates
            <span className="legend-swatch best" aria-hidden="true" /> Most popular
          </p>
          <p className="strong" aria-live="polite">
            {selected.size === 0
              ? "You haven't picked any dates yet."
              : `You've picked ${selected.size} date${selected.size === 1 ? "" : "s"}.`}
            {dirty && <span className="unsaved"> Not saved yet.</span>}
          </p>
          <div className="button-row">
            <button type="button" className="btn btn-primary" disabled={saving || !dirty} onClick={() => save([...selected].sort())}>
              {saving ? "Saving…" : "Save my dates"}
            </button>
            <button type="button" className="btn btn-secondary" disabled={saving} onClick={noneWork}>
              None of these dates work for me
            </button>
          </div>
          {mine && !dirty && (
            <p className="hint">
              {mine.dates.length ? "✓ Your dates are saved." : "✓ You said none of these dates work for you."}
            </p>
          )}
        </div>
      ) : (
        <div className="card meeting-card">
          <p className="section-label">Date poll for {monthLabel(poll.month)} is closed</p>
          {poll.finalDate ? (
            <>
              <p>The meeting date is</p>
              <p className="meeting-date">{formatDate(poll.finalDate)}</p>
            </>
          ) : (
            <p>No final date was chosen.</p>
          )}
        </div>
      )}

      <h2 className="section-title">Who's free when</h2>
      {answers.length === 0 ? (
        <p className="muted">Nobody has answered yet. Be the first!</p>
      ) : (
        <>
          <BestDates best={best} max={max} answers={answers} namesById={namesById} />
          {gridDates.length > 0 && (
            <AvailabilityGrid dates={gridDates} answers={answers} namesById={namesById} counts={counts} best={best} />
          )}
        </>
      )}
      {notAnswered.length > 0 && (
        <p className="muted">
          <strong>Not answered yet:</strong> {notAnswered.map((m) => m.name).join(", ")}
        </p>
      )}

      {isAdmin && (
        <AdminPollPanel poll={poll} allowed={allowed} counts={counts} onStartNew={onStartNew} />
      )}
    </>
  );
}

function BestDates({
  best,
  max,
  answers,
  namesById,
}: {
  best: Set<string>;
  max: number;
  answers: Availability[];
  namesById: Map<string, string>;
}) {
  if (best.size === 0) return <p className="muted">No dates picked yet.</p>;
  return (
    <div className="best-dates">
      <p className="section-label">{best.size === 1 ? "Most popular date" : "Most popular dates"}</p>
      <ul>
        {[...best].sort().map((d) => (
          <li key={d}>
            <span className="strong">{formatDate(d)}</span>: {max} {max === 1 ? "person" : "people"} (
            {answers
              .filter((a) => a.dates.includes(d))
              .map((a) => namesById.get(a.memberId) ?? a.name)
              .join(", ")}
            )
          </li>
        ))}
      </ul>
    </div>
  );
}

function AvailabilityGrid({
  dates,
  answers,
  namesById,
  counts,
  best,
}: {
  dates: string[];
  answers: Availability[];
  namesById: Map<string, string>;
  counts: Map<string, number>;
  best: Set<string>;
}) {
  const rows = [...answers].sort((a, b) =>
    (namesById.get(a.memberId) ?? a.name).localeCompare(namesById.get(b.memberId) ?? b.name),
  );
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Availability grid, scroll sideways to see more dates">
      <table className="avail-table">
        <caption className="visually-hidden">Who is available on each date</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            {dates.map((d) => (
              <th key={d} scope="col" className={best.has(d) ? "best" : ""}>
                <span className="avail-weekday">{formatDate(d, { weekday: "short" })}</span>
                <span className="avail-day">{formatDate(d, { month: "short", day: "numeric" })}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const picked = new Set(a.dates);
            return (
              <tr key={a.memberId}>
                <th scope="row">{namesById.get(a.memberId) ?? a.name}</th>
                {dates.map((d) => (
                  <td key={d} className={`${picked.has(d) ? "yes" : "no"}${best.has(d) ? " best" : ""}`}>
                    {picked.has(d) ? <span aria-label="available">✓</span> : <span className="visually-hidden">not available</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            {dates.map((d) => (
              <td key={d} className={best.has(d) ? "best" : ""}>
                {counts.get(d) ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AdminPollPanel({
  poll,
  allowed,
  counts,
  onStartNew,
}: {
  poll: Poll;
  allowed: string[];
  counts: Map<string, number>;
  onStartNew: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const ranked = [...allowed].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
  const [finalDate, setFinalDate] = useState(ranked[0] ?? "");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);

  async function close(e: FormEvent) {
    e.preventDefault();
    const ok = await confirm({
      title: finalDate ? `Set the meeting for ${formatDate(finalDate)}?` : "Close the poll without picking a date?",
      message: finalDate
        ? `The poll will close and Meeting Info will show ${formatDate(finalDate)}${time ? ` at ${formatTime(time)}` : ""}.`
        : "Members won't be able to change their dates any more.",
      confirmLabel: finalDate ? "Yes, set the date" : "Yes, close the poll",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.closePoll({ pollId: poll.id, finalDate, time });
      toast(finalDate ? "Date set! Meeting Info is updated." : "Poll closed.");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    const ok = await confirm({
      title: "Reopen this date poll?",
      message: "Members will be able to change their dates again. Meeting Info won't change.",
      confirmLabel: "Yes, reopen",
    });
    if (!ok) return;
    try {
      await api.reopenPoll({ pollId: poll.id });
      toast("Poll reopened.");
    } catch (err) {
      toast(friendlyError(err), "error");
    }
  }

  return (
    <div className="admin-panel">
      <h2 className="section-label">Admin</h2>
      {poll.status === "open" ? (
        <form onSubmit={close}>
          <Field id="final-date" label="Final meeting date" hint="Sorted with the most popular dates first.">
            <select id="final-date" className="input" value={finalDate} onChange={(e) => setFinalDate(e.target.value)}>
              {ranked.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d)} ({counts.get(d) ?? 0} free)
                </option>
              ))}
              <option value="">Don't pick a date, just close the poll</option>
            </select>
          </Field>
          <Field id="final-time" label="Meeting time (optional)" hint="Leave empty to keep the time already in Meeting Info.">
            <input id="final-time" className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <div className="button-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : finalDate ? "Close poll and set this date" : "Close poll"}
            </button>
          </div>
        </form>
      ) : (
        <div className="button-row">
          <button type="button" className="btn btn-primary" onClick={onStartNew}>
            Start a new date poll
          </button>
          <button type="button" className="btn btn-secondary" onClick={reopen}>
            Reopen this poll
          </button>
        </div>
      )}
    </div>
  );
}

function OpenPollForm({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [month, setMonth] = useState(nextMonth());
  const [limitDates, setLimitDates] = useState(false);
  const [candidates, setCandidates] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validMonth = /^\d{4}-\d{2}$/.test(month);
  const monthDates = useMemo(
    () => new Set(validMonth ? datesInMonth(month).filter((d) => d >= todayIso()) : []),
    [month, validMonth],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!validMonth) return setError("Please pick a month.");
    if (limitDates && candidates.size === 0) return setError("Tap at least one date to offer, or switch off \"Only certain dates\".");
    setBusy(true);
    try {
      await api.openPoll({ month, candidateDates: limitDates ? [...candidates].sort() : [], note });
      toast("Date poll is open! Members can now pick their dates.");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="section-title flush">Start a date poll</h2>
      <Field id="poll-month" label="Month">
        <input
          id="poll-month"
          className="input"
          type="month"
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            setCandidates(new Set());
          }}
        />
      </Field>
      <label className="checkbox">
        <input type="checkbox" checked={limitDates} onChange={(e) => setLimitDates(e.target.checked)} />
        <span>Only certain dates (otherwise members can pick any day of the month)</span>
      </label>
      {limitDates && validMonth && (
        <>
          <p className="hint">Tap the dates you want to offer.</p>
          <MonthCalendar
            month={month}
            enabled={monthDates}
            selected={candidates}
            selectedLabel="offered"
            onToggle={(d) =>
              setCandidates((s) => {
                const n = new Set(s);
                if (n.has(d)) n.delete(d);
                else n.add(d);
                return n;
              })
            }
          />
          <p className="strong">{candidates.size} date{candidates.size === 1 ? "" : "s"} offered</p>
        </>
      )}
      <Field id="poll-note" label="Message to members (optional)" hint='For example "We usually meet on Thursday evenings."'>
        <textarea id="poll-note" className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Opening…" : "Open the date poll"}
        </button>
      </div>
    </form>
  );
}
