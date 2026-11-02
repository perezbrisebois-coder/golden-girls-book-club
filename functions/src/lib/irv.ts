/**
 * Instant-runoff (ranked-choice) tally.
 *
 * Each round, every ballot counts for its highest-ranked option that is still
 * in the running. If an option has more than half of those votes, it wins.
 * Otherwise the option with the fewest votes is eliminated and the next round
 * starts. Ballots with no remaining options are "exhausted" and stop counting.
 *
 * Tie-break when several options share the fewest votes (applied in order):
 *   1. Earlier rounds: the option with fewer votes in the earliest round where
 *      the tied options' counts differed is eliminated.
 *   2. Ranked lower: the option that ballots ranked below the other tied
 *      options more often is eliminated (an unranked option counts as below
 *      every ranked one).
 *   3. Random draw.
 */

export type TieBreakMethod = "earlier-round" | "ranked-lower" | "random";

export interface TieBreak {
  tied: string[];
  method: TieBreakMethod;
}

export interface Round {
  /** Votes per option still in the running, in candidate order. */
  counts: { key: string; votes: number }[];
  /** Ballots that no longer rank any option still in the running. */
  exhausted: number;
  /** Option eliminated at the end of this round (null in the final round). */
  eliminated: string | null;
  /** Winner decided in this round (null otherwise). */
  winner: string | null;
  /** Set when a tie for fewest votes had to be broken this round. */
  tieBreak: TieBreak | null;
}

export interface TallyResult {
  winner: string | null;
  totalBallots: number;
  rounds: Round[];
}

/** Returns an integer in [0, n). Injected so tests can control random draws. */
export type Rng = (n: number) => number;

const defaultRng: Rng = (n) => Math.floor(Math.random() * n);

export function tally(candidates: string[], ballots: string[][], rng: Rng = defaultRng): TallyResult {
  const valid = new Set(candidates);
  // Clean ballots: drop unknown options and repeats, keep order.
  const clean = ballots
    .map((b) => [...new Set(b.filter((k) => valid.has(k)))])
    .filter((b) => b.length > 0);

  const result: TallyResult = { winner: null, totalBallots: clean.length, rounds: [] };
  if (clean.length === 0 || candidates.length === 0) return result;

  const active = new Set(candidates);
  const history: Map<string, number>[] = [];

  while (active.size > 0) {
    const counts = new Map<string, number>([...active].map((k) => [k, 0]));
    let exhausted = 0;
    for (const b of clean) {
      const top = b.find((k) => active.has(k));
      if (top) counts.set(top, counts.get(top)! + 1);
      else exhausted++;
    }
    history.push(counts);
    const round: Round = {
      counts: candidates.filter((k) => active.has(k)).map((key) => ({ key, votes: counts.get(key)! })),
      exhausted,
      eliminated: null,
      winner: null,
      tieBreak: null,
    };
    result.rounds.push(round);

    const continuing = clean.length - exhausted;
    const leader = [...counts].find(([, v]) => v * 2 > continuing);
    if (leader || active.size === 1) {
      round.winner = leader ? leader[0] : [...active][0];
      result.winner = round.winner;
      return result;
    }

    const fewest = Math.min(...counts.values());
    const tied = [...active].filter((k) => counts.get(k) === fewest);
    let loser: string;
    if (tied.length === 1) {
      loser = tied[0];
    } else {
      const broken = breakTie(tied, history.slice(0, -1), clean, rng);
      loser = broken.loser;
      round.tieBreak = { tied: candidates.filter((k) => tied.includes(k)), method: broken.method };
    }
    round.eliminated = loser;
    active.delete(loser);
  }
  return result;
}

function breakTie(
  tied: string[],
  earlierRounds: Map<string, number>[],
  ballots: string[][],
  rng: Rng,
): { loser: string; method: TieBreakMethod } {
  // 1. Earliest round where the tied options' counts differed.
  let pool = tied;
  for (const round of earlierRounds) {
    const min = Math.min(...pool.map((k) => round.get(k) ?? 0));
    const lowest = pool.filter((k) => (round.get(k) ?? 0) === min);
    if (lowest.length < pool.length) {
      pool = lowest;
      if (pool.length === 1) return { loser: pool[0], method: "earlier-round" };
    }
  }
  // 2. Ranked below the other tied options on the most ballots.
  const belowCount = new Map(pool.map((k) => [k, 0]));
  for (const b of ballots) {
    const pos = (k: string) => {
      const i = b.indexOf(k);
      return i === -1 ? Infinity : i;
    };
    for (const a of pool) {
      for (const other of pool) {
        if (a !== other && pos(a) > pos(other)) belowCount.set(a, belowCount.get(a)! + 1);
      }
    }
  }
  const most = Math.max(...belowCount.values());
  const worst = pool.filter((k) => belowCount.get(k) === most);
  if (worst.length === 1) return { loser: worst[0], method: "ranked-lower" };

  // 3. Random draw.
  return { loser: worst[rng(worst.length)], method: "random" };
}
