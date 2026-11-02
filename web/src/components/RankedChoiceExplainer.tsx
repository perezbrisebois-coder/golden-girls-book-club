import { forwardRef } from "react";

type Kind = "book" | "place";

const EXAMPLE: Record<Kind, { a: string; b: string; c: string; noun: string; nouns: string }> = {
  book: { a: "Mystery", b: "Memoir", c: "Romance", noun: "book", nouns: "books" },
  place: { a: "Bistro", b: "Diner", c: "Café", noun: "place", nouns: "places" },
};

/** One row of the illustrated example: a name, a row of vote dots, and a count. */
function Bar({ label, votes, out, winner }: { label: string; votes: number; out?: boolean; winner?: boolean }) {
  return (
    <div className={`example-bar${out ? " is-out" : ""}${winner ? " is-winner" : ""}`}>
      <span className="example-name">{label}</span>
      <span className="example-dots" aria-hidden="true">
        {"●".repeat(votes)}
      </span>
      <span className="example-count">
        {votes} {votes === 1 ? "vote" : "votes"}
        {out && " · out"}
        {winner && " · wins!"}
      </span>
    </div>
  );
}

/**
 * "How ranked voting works": a plain-language, collapsible explainer with a
 * small illustrated example. Shown next to the ballot and next to results.
 */
export const RankedChoiceExplainer = forwardRef<
  HTMLDetailsElement,
  { kind: Kind; open?: boolean; onToggle?: (open: boolean) => void }
>(function RankedChoiceExplainer({ kind, open, onToggle }, ref) {
  const e = EXAMPLE[kind];
  return (
    <details
      ref={ref}
      className="explainer"
      open={open}
      onToggle={(ev) => onToggle?.((ev.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>How ranked voting works</summary>
      <div className="explainer-body">
        <ol className="explainer-steps">
          <li>
            <strong>Pick up to 6 {e.nouns} and rank them.</strong> Your favorite is #1, your next favorite is #2, and so
            on. Fewer than 6 is fine.
          </li>
          <li>
            <strong>We count everyone's #1 choice.</strong> If one {e.noun} has <em>more than half</em> of the votes, it
            wins.
          </li>
          <li>
            <strong>If not, the {e.noun} with the fewest votes is out.</strong> Every ballot that was counting for it moves
            to that voter's next choice.
          </li>
          <li>
            <strong>Repeat</strong> until one {e.noun} has more than half.
          </li>
        </ol>
        <p>Your vote is never wasted: if your favorite is out, your vote moves on to help your next choice.</p>

        <h4 className="explainer-heading">An example with 5 members and 3 {e.nouns}</h4>
        <ul className="example-ballots">
          <li>Ann: 1. {e.a}, 2. {e.b}</li>
          <li>Bea: 1. {e.a}, 2. {e.c}</li>
          <li>Cat: 1. {e.b}, 2. {e.a}</li>
          <li>Dee: 1. {e.b}</li>
          <li>Eve: 1. {e.c}, 2. {e.b}</li>
        </ul>

        <div className="example-round">
          <p className="example-round-title">Round 1: count the #1 choices (3 votes needed to win)</p>
          <Bar label={e.a} votes={2} />
          <Bar label={e.b} votes={2} />
          <Bar label={e.c} votes={1} out />
          <p className="muted">
            Nobody has 3 yet. {e.c} has the fewest, so it's out. Eve's ballot moves to her #2, {e.b}.
          </p>
        </div>
        <div className="example-round">
          <p className="example-round-title">Round 2</p>
          <Bar label={e.a} votes={2} />
          <Bar label={e.b} votes={3} winner />
          <p className="muted">
            {e.b} has 3 of 5 votes, more than half, so {e.b} wins.
          </p>
        </div>

        <h4 className="explainer-heading">What if there's a tie for fewest votes?</h4>
        <ol className="explainer-steps">
          <li>The one that had fewer votes in an earlier round is out.</li>
          <li>Still tied? The one that more ballots ranked lower is out.</li>
          <li>Still tied? A random draw decides, and the results will say so.</li>
        </ol>

        <h4 className="explainer-heading">Is my vote secret?</h4>
        <p>
          Yes, your vote is secret. Only the totals for each round are shown.
        </p>
      </div>
    </details>
  );
});
