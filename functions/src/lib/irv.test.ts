import { describe, expect, it } from "vitest";
import { tally } from "./irv";

const votes = (round: { counts: { key: string; votes: number }[] }) =>
  Object.fromEntries(round.counts.map((c) => [c.key, c.votes]));

/** Repeats a ballot n times. */
const times = (n: number, ballot: string[]) => Array.from({ length: n }, () => ballot);

describe("instant-runoff tally", () => {
  it("returns no winner when there are no ballots", () => {
    expect(tally(["A", "B"], [])).toEqual({ winner: null, totalBallots: 0, rounds: [] });
  });

  it("declares a first-round majority winner immediately", () => {
    const r = tally(["A", "B", "C"], [...times(3, ["A"]), ["B"], ["C"]]);
    expect(r.winner).toBe("A");
    expect(r.rounds).toHaveLength(1);
    expect(votes(r.rounds[0])).toEqual({ A: 3, B: 1, C: 1 });
  });

  it("matches the explainer example: lowest is eliminated and votes transfer", () => {
    // 5 voters: A 2, B 2, C 1 → C out, its voter's 2nd choice is B → B wins 3–2.
    const r = tally(["A", "B", "C"], [["A", "B"], ["A", "C"], ["B", "A"], ["B"], ["C", "B"]]);
    expect(votes(r.rounds[0])).toEqual({ A: 2, B: 2, C: 1 });
    expect(r.rounds[0].eliminated).toBe("C");
    expect(votes(r.rounds[1])).toEqual({ A: 2, B: 3 });
    expect(r.winner).toBe("B");
    expect(r.rounds[1].winner).toBe("B");
  });

  it("needs more than half of continuing ballots, not just a plurality", () => {
    // A leads round 1 with 4 of 9 but loses once D and C transfer to B.
    const r = tally(
      ["A", "B", "C", "D"],
      [...times(4, ["A"]), ...times(3, ["B"]), ...times(1, ["C", "B"]), ...times(1, ["D", "C", "B"])],
    );
    expect(r.rounds[0].winner).toBeNull();
    expect(r.winner).toBe("B");
  });

  it("counts exhausted ballots separately and ignores them for the majority", () => {
    // C's voters rank nobody else, so their ballots exhaust; A then has 3 of 5 continuing.
    const r = tally(["A", "B", "C"], [...times(3, ["A"]), ...times(2, ["B"]), ...times(2, ["C"])], () => 0);
    const last = r.rounds[r.rounds.length - 1];
    expect(last.exhausted).toBe(2);
    expect(r.winner).toBe("A");
  });

  it("ignores unknown options and repeated rankings, and drops empty ballots", () => {
    const r = tally(["A", "B"], [["X", "A", "A"], [], ["Z"], ["B"], ["A", "B"]]);
    expect(r.totalBallots).toBe(3);
    expect(votes(r.rounds[0])).toEqual({ A: 2, B: 1 });
    expect(r.winner).toBe("A");
  });

  it("tie-break 1: eliminates whoever had fewer votes in the earliest round they differed", () => {
    // Round 1: A 4, B 3, C 2, D 1. D → C. Round 2: A 4, B 3, C 3 → B and C tied for fewest.
    // In round 1, C had fewer than B, so C is eliminated.
    const r = tally(
      ["A", "B", "C", "D"],
      [...times(4, ["A"]), ...times(3, ["B"]), ...times(2, ["C"]), ["D", "C"]],
    );
    expect(votes(r.rounds[1])).toEqual({ A: 4, B: 3, C: 3 });
    expect(r.rounds[1].eliminated).toBe("C");
    expect(r.rounds[1].tieBreak).toEqual({ tied: ["B", "C"], method: "earlier-round" });
  });

  it("tie-break 2: eliminates the option ranked lower on more ballots", () => {
    // Round 1: A 3, B 2, C 2 (tied from the start, so no earlier round helps).
    // A's voters all prefer B over C, so C is ranked lower more often → C out.
    const r = tally(["A", "B", "C"], [...times(3, ["A", "B", "C"]), ...times(2, ["B"]), ...times(2, ["C"])]);
    expect(r.rounds[0].eliminated).toBe("C");
    expect(r.rounds[0].tieBreak).toEqual({ tied: ["B", "C"], method: "ranked-lower" });
    expect(r.winner).toBe("A"); // C's ballots exhaust, so A has 3 of 5 continuing
  });

  it("tie-break 3: random draw when everything else is equal", () => {
    const ballots = [["A"], ["B"]];
    const first = tally(["A", "B"], ballots, () => 0);
    expect(first.rounds[0].tieBreak).toEqual({ tied: ["A", "B"], method: "random" });
    expect(first.rounds[0].eliminated).toBe("A");
    expect(first.winner).toBe("B");
    const second = tally(["A", "B"], ballots, () => 1);
    expect(second.winner).toBe("A");
  });

  it("breaks a three-way tie with earlier rounds, then rankings", () => {
    // Round 1: A 3, B 3, C 3, D 2, E 1. E → D (D 3). Round 2: everyone has 3.
    // Earlier round: D had 2 (fewest) → D eliminated.
    const r = tally(
      ["A", "B", "C", "D", "E"],
      [...times(3, ["A"]), ...times(3, ["B"]), ...times(3, ["C"]), ...times(2, ["D"]), ["E", "D"]],
      () => 0,
    );
    expect(r.rounds[1].tieBreak?.method).toBe("earlier-round");
    expect(r.rounds[1].eliminated).toBe("D");
  });

  it("works with a single option", () => {
    const r = tally(["A"], [["A"]]);
    expect(r.winner).toBe("A");
  });

  it("always produces a winner when there is at least one ballot", () => {
    const keys = ["A", "B", "C", "D", "E"];
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let trial = 0; trial < 300; trial++) {
      const ballots = Array.from({ length: 1 + rand(12) }, () => {
        const shuffled = [...keys].sort(() => rand(3) - 1);
        return shuffled.slice(0, 1 + rand(keys.length));
      });
      const r = tally(keys, ballots, rand);
      expect(keys).toContain(r.winner);
      const last = r.rounds[r.rounds.length - 1];
      expect(last.winner).toBe(r.winner);
      // Every round's votes plus exhausted ballots add up to the total.
      for (const round of r.rounds) {
        expect(round.counts.reduce((s, c) => s + c.votes, 0) + round.exhausted).toBe(r.totalBallots);
      }
    }
  });
});
