import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { collection, doc, limit, orderBy, query } from "firebase/firestore";
import { firestore } from "../firebase";
import { useCollection, useDoc } from "../hooks";
import { useSession } from "../session";
import { api, friendlyError } from "../api";
import { useConfirm, useToast } from "../components/Feedback";
import { BookCard } from "../components/BookCard";
import { DecoDivider } from "../components/Deco";
import { Field } from "../components/Field";
import { RankedChoiceExplainer } from "../components/RankedChoiceExplainer";
import { mapsLink } from "../format";
import type { Election, ElectionCandidate, Meeting, Member, PastMeeting, Proposal, TallyResult, TallyRound } from "../types";

const electionsQuery = query(collection(firestore, "elections"), orderBy("createdAt", "desc"), limit(12));
const membersQuery = query(collection(firestore, "members"), orderBy("nameKey"));
const proposalsQuery = query(collection(firestore, "proposals"), orderBy("createdAt", "desc"));
const meetingRef = doc(firestore, "config", "meeting");
const pastQuery = query(collection(firestore, "pastMeetings"), orderBy("date", "desc"));

const KIND_LABEL = { book: "Books", place: "Places" } as const;
/** Each member ranks up to this many choices (the server enforces the same limit). */
const MAX_RANKED = 6;

export function VotePage() {
  const { isAdmin } = useSession();
  const { data: elections, loading } = useCollection<Election>(electionsQuery, "elections");
  const [starting, setStarting] = useState(false);

  if (loading) return <p className="loading">Loading…</p>;

  const open = elections.filter((e) => e.status === "open");
  const closed = elections.filter((e) => e.status === "closed");
  const [latest, ...older] = closed;

  return (
    <section>
      <h1 className="page-title">Vote</h1>
      <DecoDivider />

      {isAdmin &&
        (starting ? (
          <StartVoteForm onDone={() => setStarting(false)} />
        ) : (
          <div className="button-row center-row">
            <button type="button" className="btn btn-primary" onClick={() => setStarting(true)}>
              + Start a new vote
            </button>
          </div>
        ))}

      {open.length === 0 && !starting && (
        <div className="card stack-gap">
          <p>
            There's no vote open right now.{" "}
            {isAdmin ? "Start one when the club is ready to choose." : "The admin will open one when it's time to choose."}
          </p>
        </div>
      )}

      {open.map((e) => (
        <OpenElection key={e.id} election={e} />
      ))}

      {latest && (
        <>
          <h2 className="section-title">Latest results</h2>
          <ClosedElection election={latest} />
        </>
      )}

      {older.length > 0 && (
        <details className="past-votes">
          <summary>Earlier votes ({older.length})</summary>
          {older.map((e) => (
            <ClosedElection key={e.id} election={e} />
          ))}
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Open vote: the ballot, who has voted, and admin controls

function OpenElection({ election }: { election: Election }) {
  const { isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [helpOpen, setHelpOpen] = useState(false);
  const helpRef = useRef<HTMLDetailsElement>(null);
  const { data: members } = useCollection<Member>(membersQuery, "members");

  const voterIds = Object.keys(election.voters ?? {});
  const voterNames = Object.values(election.voters ?? {}).sort((a, b) => a.localeCompare(b));
  const notYet = members.filter((m) => !election.voters?.[m.id]).map((m) => m.name);

  function showHelp() {
    setHelpOpen(true);
    requestAnimationFrame(() => helpRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function close() {
    const ok = await confirm({
      title: "Close voting and count the votes?",
      message: `${voterIds.length} ${voterIds.length === 1 ? "member has" : "members have"} voted. Once closed, nobody else can vote (you can reopen it if needed).`,
      confirmLabel: "Close and count",
    });
    if (!ok) return;
    try {
      await api.closeElection({ electionId: election.id });
      toast("Voting is closed. Here are the results!");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  return (
    <article className="card election">
      <header className="election-header">
        <h2 className="section-title flush">{election.title}</h2>
        <span className="badge">{KIND_LABEL[election.kind]} · Voting open</span>
      </header>

      <Ballot election={election} onHelp={showHelp} />

      <div className="voters">
        <h3 className="section-label">
          Voted so far: {voterIds.length}
          {members.length > 0 && ` of ${members.length}`}
        </h3>
        <p>{voterNames.length ? voterNames.join(", ") : "Nobody yet. Be the first!"}</p>
        {notYet.length > 0 && voterNames.length > 0 && <p className="muted">Still to vote: {notYet.join(", ")}</p>}
        <p className="hint">Only names are shown here. Votes are secret.</p>
      </div>

      <RankedChoiceExplainer ref={helpRef} kind={election.kind} open={helpOpen} onToggle={setHelpOpen} />

      {isAdmin && (
        <div className="admin-panel">
          <h3 className="section-label">Admin</h3>
          <div className="button-row">
            <button type="button" className="btn btn-primary" onClick={close}>
              Close voting and count the votes
            </button>
            <DeleteElectionButton election={election} />
          </div>
        </div>
      )}
    </article>
  );
}

function Ballot({ election, onHelp }: { election: Election; onHelp: () => void }) {
  const { memberId } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const [saved, setSaved] = useState<string[] | null>(null); // null while loading
  const [ranking, setRanking] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const hasVoted = !!memberId && !!election.voters?.[memberId];

  useEffect(() => {
    let live = true;
    api
      .getMyBallot({ electionId: election.id })
      .then((r) => {
        if (!live) return;
        setSaved(r.ranking);
        setRanking(r.ranking);
      })
      .catch(() => live && (setSaved([]), setRanking([])));
    return () => {
      live = false;
    };
  }, [election.id, memberId]);

  const byKey = useMemo(() => new Map(election.candidates.map((c) => [c.key, c])), [election.candidates]);
  const unranked = election.candidates.filter((c) => !ranking.includes(c.key));
  const limit = Math.min(MAX_RANKED, election.candidates.length);
  const full = ranking.length >= limit;
  const noun = election.kind === "book" ? "book" : "place";

  const move = (i: number, delta: number) =>
    setRanking((r) => {
      const next = [...r];
      [next[i], next[i + delta]] = [next[i + delta], next[i]];
      return next;
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (ranking.length === 0) return;
    const names = ranking.map((k, i) => `${i + 1}. ${byKey.get(k)?.label}`).join("\n");
    const ok = await confirm({
      title: "Submit your vote?",
      message: `${names}\n\nOnce submitted, your vote is final and can't be changed.`,
      confirmLabel: "Yes, submit my vote",
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.submitBallot({ electionId: election.id, ranking });
      setSaved(ranking);
      toast("Your vote is in!");
    } catch (err) {
      toast(friendlyError(err), "error");
    } finally {
      setSaving(false);
    }
  }

  if (saved === null) return <p className="loading">Loading your ballot…</p>;

  if (hasVoted || saved.length > 0) {
    return (
      <div className="ballot">
        <p className="notice success-notice">
          <strong>✓ Your vote is in.</strong> Thank you! Results will be shown here when voting closes.
        </p>
        {saved.length > 0 && (
          <>
            <h3 className="section-label">How you voted</h3>
            <ol className="my-vote">
              {saved.map((k) => (
                <li key={k}>{byKey.get(k)?.label ?? "(removed)"}</li>
              ))}
            </ol>
          </>
        )}
        <p className="hint">
          🔒 Your vote is secret.{" "}
          <button type="button" className="btn-link help-link" onClick={onHelp} aria-label="How ranked voting works">
            <span aria-hidden="true">?</span> How are the votes counted?
          </button>
        </p>
      </div>
    );
  }

  return (
    <form className="ballot" onSubmit={submit}>
      <div className="how-to-vote">
        <h3 className="how-to-vote-title">How to vote</h3>
        <ol>
          <li>
            Look through the {noun}s below and choose up to <strong>{limit}</strong> you'd most like. Fewer is fine.
          </li>
          <li>
            Tap <strong>Add</strong> on your favorite first. It becomes <strong>#1</strong>.
          </li>
          <li>
            Keep tapping <strong>Add</strong> on your next favorites (#2, #3…).
          </li>
          <li>
            Changed your mind? Use <strong>▲ Up</strong> and <strong>▼ Down</strong> to reorder, or{" "}
            <strong>Remove</strong> to take one off.
          </li>
          <li>
            Check your order, then tap <strong>Submit my vote</strong> at the bottom. Once submitted, your vote is
            final.
          </li>
        </ol>
        <p className="how-to-vote-foot">
          🔒 Your vote is secret.{" "}
          <button type="button" className="btn-link help-link" onClick={onHelp} aria-label="How ranked voting works">
            <span aria-hidden="true">?</span> How are the votes counted?
          </button>
        </p>
      </div>

      <h3 className="section-label">
        Your ranking ({ranking.length} of {limit})
      </h3>
      {ranking.length === 0 ? (
        <p className="empty-ranking">Nothing ranked yet. Add your favorite from the list below.</p>
      ) : (
        <ol className="rank-list">
          {ranking.map((key, i) => {
            const c = byKey.get(key)!;
            return (
              <li key={key} className="rank-item">
                <span className="rank-number" aria-hidden="true">
                  {i + 1}
                </span>
                <CandidateLabel c={c} rank={i + 1} />
                <div className="rank-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move ${c.label} up`}
                  >
                    ▲ Up
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => move(i, 1)}
                    disabled={i === ranking.length - 1}
                    aria-label={`Move ${c.label} down`}
                  >
                    ▼ Down
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    onClick={() => setRanking((r) => r.filter((k) => k !== key))}
                    aria-label={`Remove ${c.label} from my ranking`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {unranked.length > 0 && (
        <>
          <h3 className="section-label">{ranking.length === 0 ? "Choices" : "Not ranked"}</h3>
          {full && (
            <p className="notice">
              You've picked {limit}, the most you can rank. To add a different one, first <strong>Remove</strong> one from
              your ranking.
            </p>
          )}
          <ul className="rank-list unranked">
            {unranked.map((c) => (
              <li key={c.key} className="rank-item">
                <CandidateLabel c={c} />
                <div className="rank-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => setRanking((r) => [...r, c.key])}
                    disabled={full}
                    aria-label={`Add ${c.label} as choice number ${ranking.length + 1}`}
                  >
                    Add as #{ranking.length + 1}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="button-row">
        <button type="submit" className="btn btn-primary btn-large" disabled={saving || ranking.length === 0}>
          {saving ? "Submitting…" : "Submit my vote"}
        </button>
      </div>
    </form>
  );
}

function CandidateLabel({ c, rank }: { c: ElectionCandidate; rank?: number }) {
  return (
    <div className="rank-label">
      {rank !== undefined && <span className="visually-hidden">Choice {rank}: </span>}
      <span className="rank-title">{c.label}</span>
      {c.sublabel && <span className="rank-sub">{c.book ? "by " : ""}{c.sublabel}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Closed vote: winner, round-by-round results, admin controls

function ClosedElection({ election }: { election: Election }) {
  const { isAdmin } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const results = election.results;
  const winner = results?.winner ? election.candidates.find((c) => c.key === results.winner) : undefined;

  async function reopen() {
    const ok = await confirm({
      title: "Reopen voting?",
      message: "The results will be hidden again so members who haven't voted yet can vote. Votes already cast are kept.",
      confirmLabel: "Reopen voting",
    });
    if (!ok) return;
    try {
      await api.reopenElection({ electionId: election.id });
      toast("Voting is open again.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }

  return (
    <article className="card election">
      <header className="election-header">
        <h2 className="section-title flush">{election.title}</h2>
        <span className="badge">{KIND_LABEL[election.kind]} · Closed</span>
      </header>

      {!results || !winner ? (
        <p>No ballots were cast, so there's no winner.</p>
      ) : (
        <>
          <div className="winner">
            <p className="winner-label">The winner is</p>
            {winner.book ? (
              <BookCard book={winner.book} />
            ) : (
              <div className="winner-place">
                <h3 className="book-title">{winner.label}</h3>
                {winner.sublabel && <p>{winner.sublabel}</p>}
                {winner.place && !winner.place.isPrivate && winner.place.address && (
                  <a className="btn btn-secondary btn-small" href={mapsLink(winner.sublabel, "")} target="_blank" rel="noreferrer">
                    Open in Maps
                  </a>
                )}
              </div>
            )}
          </div>
          <Rounds results={results} candidates={election.candidates} />
        </>
      )}

      <RankedChoiceExplainer kind={election.kind} />

      {isAdmin && (
        <div className="admin-panel">
          <h3 className="section-label">Admin</h3>
          {winner && (
            <p className="hint">
              To make "{winner.label}" {election.kind === "book" ? "the book" : "the place"} for a meeting, go to{" "}
              <Link to="/">Meeting Info</Link>, tap <strong>Edit meeting details</strong> and choose it from the list
              (it's marked with ★).
            </p>
          )}
          <div className="button-row">
            <button type="button" className="btn btn-secondary" onClick={reopen}>
              Reopen voting
            </button>
            <DeleteElectionButton election={election} />
          </div>
        </div>
      )}
    </article>
  );
}

/** Round-by-round results: a plain-language story plus a compact table. Counts only, never names. */
function Rounds({ results, candidates }: { results: TallyResult; candidates: ElectionCandidate[] }) {
  const label = (key: string) => candidates.find((c) => c.key === key)?.label ?? "(removed)";
  const lastRound = new Map<string, number>();
  results.rounds.forEach((r, i) => r.counts.forEach((c) => lastRound.set(c.key, i)));
  // Winner first, then in reverse order of elimination.
  const order = [...candidates].sort(
    (a, b) =>
      (b.key === results.winner ? 1 : 0) - (a.key === results.winner ? 1 : 0) ||
      (lastRound.get(b.key) ?? -1) - (lastRound.get(a.key) ?? -1),
  );
  const anyExhausted = results.rounds.some((r) => r.exhausted > 0);

  return (
    <div className="rounds">
      <h3 className="section-label">
        How the votes were counted ({results.totalBallots} {results.totalBallots === 1 ? "ballot" : "ballots"})
      </h3>
      <ol className="round-story">
        {results.rounds.map((r, i) => (
          <li key={i}>
            <strong>Round {i + 1}:</strong> {roundStory(r, label)}
          </li>
        ))}
      </ol>

      <div className="table-scroll">
        <table className="rounds-table">
          <caption className="visually-hidden">Votes in each round</caption>
          <thead>
            <tr>
              <th scope="col">Choice</th>
              {results.rounds.map((_, i) => (
                <th key={i} scope="col">
                  Round {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.map((c) => (
              <tr key={c.key} className={c.key === results.winner ? "is-winner" : ""}>
                <th scope="row">{c.label}</th>
                {results.rounds.map((r, i) => {
                  const count = r.counts.find((x) => x.key === c.key);
                  const out = r.eliminated === c.key;
                  const won = r.winner === c.key;
                  return (
                    <td key={i} className={out ? "is-out" : won ? "is-winner" : ""}>
                      {count ? (
                        <>
                          {count.votes}
                          {out && <span className="cell-note"> out</span>}
                          {won && <span className="cell-note"> wins</span>}
                        </>
                      ) : (
                        <span className="muted" aria-label="already out">
                          –
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {anyExhausted && (
              <tr className="exhausted-row">
                <th scope="row">No choices left</th>
                {results.rounds.map((r, i) => (
                  <td key={i}>{r.exhausted}</td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {anyExhausted && (
        <p className="hint">
          "No choices left" means ballots that didn't rank any of the remaining choices. They don't count toward the
          majority in later rounds.
        </p>
      )}
    </div>
  );
}

function roundStory(r: TallyRound, label: (key: string) => string): string {
  const continuing = r.counts.reduce((s, c) => s + c.votes, 0);
  const needed = Math.floor(continuing / 2) + 1;
  const counts = r.counts
    .slice()
    .sort((a, b) => b.votes - a.votes)
    .map((c) => `${label(c.key)} ${c.votes}`)
    .join(", ");
  if (r.winner) {
    const w = r.counts.find((c) => c.key === r.winner)!;
    return r.counts.length === 1
      ? `${counts}. ${label(r.winner)} is the only choice left, so it wins.`
      : `${counts}. ${label(r.winner)} has ${w.votes} of ${continuing} votes, more than half, so it wins!`;
  }
  const out = label(r.eliminated!);
  let text = `${counts}. Nobody has more than half (${needed} needed). `;
  if (!r.tieBreak) return text + `${out} has the fewest votes, so it's out.`;
  const others = r.tieBreak.tied.filter((k) => k !== r.eliminated).map(label);
  const tiedWith = others.join(" and ");
  if (r.tieBreak.method === "earlier-round") {
    text += `${out} and ${tiedWith} were tied for fewest. ${out} had fewer votes in an earlier round, so it's out.`;
  } else if (r.tieBreak.method === "ranked-lower") {
    text += `${out} and ${tiedWith} were tied for fewest. More ballots ranked ${out} lower, so it's out.`;
  } else {
    text += `${out} and ${tiedWith} were still tied after every tie-break rule, so a random draw decided: ${out} is out.`;
  }
  return text;
}

// ---------------------------------------------------------------------------

function DeleteElectionButton({ election }: { election: Election }) {
  const toast = useToast();
  const confirm = useConfirm();
  async function remove() {
    const ok = await confirm({
      title: `Delete "${election.title}"?`,
      message: "The vote, all its ballots and its results will be permanently deleted. This can't be undone.",
      confirmLabel: "Delete this vote",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteElection({ electionId: election.id });
      toast("The vote was deleted.");
    } catch (e) {
      toast(friendlyError(e), "error");
    }
  }
  return (
    <button type="button" className="btn btn-danger-outline" onClick={remove}>
      Delete this vote
    </button>
  );
}

function StartVoteForm({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const { data: proposals, loading } = useCollection<Proposal>(proposalsQuery, "proposals-all");
  const [kind, setKind] = useState<"book" | "place">("book");
  const [title, setTitle] = useState("Next book");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data: meeting } = useDoc<Meeting>(meetingRef, "meeting");
  const { data: past } = useCollection<PastMeeting>(pastQuery, "past");
  // Books already chosen for the next meeting or a past one can't be voted on again.
  const chosenForMeeting = new Set([meeting?.book?.key, ...past.map((p) => p.book?.key)].filter(Boolean));
  const usedCount = proposals.filter((p) => p.kind === "book" && chosenForMeeting.has(p.key)).length;
  const options = proposals.filter((p) => p.kind === kind && !(kind === "book" && chosenForMeeting.has(p.key)));

  // Pre-select every suggestion of the chosen kind.
  useEffect(() => {
    setPicked(new Set(options.map((p) => p.key)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, loading, options.length]);

  function switchKind(k: "book" | "place") {
    setKind(k);
    setTitle(k === "book" ? "Next book" : "Next meeting place");
    setError("");
  }

  function toggle(key: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError("Please give the vote a title.");
    if (picked.size < 2) return setError("Please pick at least 2 choices for the ballot.");
    setBusy(true);
    setError("");
    try {
      const keys = options.filter((p) => picked.has(p.key)).map((p) => p.key);
      await api.openElection({ kind, title, candidateKeys: keys });
      toast("Voting is open!");
      onDone();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form className="card flow" onSubmit={submit} noValidate>
      <h2 className="section-title flush">Start a new vote</h2>
      <div className="segmented" role="tablist" aria-label="What are we voting on?">
        {(["book", "place"] as const).map((k) => (
          <button key={k} type="button" role="tab" className="segment" aria-selected={kind === k} onClick={() => switchKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <Field id="vote-title" label="Title" hint='For example "Next book" or "December meeting place".'>
        <input id="vote-title" className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <fieldset className="fieldset">
        <legend className="label">Choices on the ballot</legend>
        {loading ? (
          <p className="loading">Loading…</p>
        ) : options.length < 2 ? (
          <p className="notice">
            There {options.length === 1 ? "is only 1 suggested " + kind : `are no suggested ${kind}s`} yet. Members can add
            them on the Suggest tab; a vote needs at least 2.
          </p>
        ) : (
          <>
            <p className="hint">
              Every suggestion is ticked; untick any you want to leave off. Members will each rank their top {MAX_RANKED}.
            </p>
            {kind === "book" && usedCount > 0 && (
              <p className="hint">
                {usedCount === 1 ? "1 recommended book isn't" : `${usedCount} recommended books aren't`} listed because{" "}
                {usedCount === 1 ? "it was" : "they were"} already chosen for a meeting.
              </p>
            )}
            {options.map((p) => (
              <label key={p.key} className="checkbox">
                <input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} />
                <span>
                  <strong>{p.kind === "book" ? p.book?.title : p.place?.name}</strong>
                  <span className="muted">
                    {" "}
                    · {p.kind === "book" ? p.book?.authors.join(", ") : p.place?.isPrivate ? "Private home" : p.place?.city || p.place?.address}
                    {" "}· suggested by {p.proposerName}
                  </span>
                </span>
              </label>
            ))}
          </>
        )}
      </fieldset>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="submit" className="btn btn-primary" disabled={busy || options.length < 2}>
          {busy ? "Opening…" : `Open voting (${picked.size} choices)`}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}
