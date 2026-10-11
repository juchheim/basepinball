/**
 * Base running (docs/MVP/01 § 4.4). Pure functions over a 3-base occupancy array.
 * Index 0 = first base, 1 = second, 2 = third.
 */

export type Bases = readonly [boolean, boolean, boolean];

export const EMPTY: Bases = [false, false, false];

/**
 * The batter reaches base `n` (1-3) or scores (4) and every runner advances `n` bases.
 * Returns the new bases and how many runs scored (runners plus the batter on a home run).
 */
export function advance(bases: Bases, n: number): { bases: Bases; runs: number } {
  const next: [boolean, boolean, boolean] = [false, false, false];
  let runs = 0;
  // Runners already on base, lead runner first.
  for (let i = 2; i >= 0; i--) {
    if (!bases[i]) continue;
    const to = i + n;
    if (to >= 3) runs++;
    else next[to] = true;
  }
  // The batter.
  if (n >= 4) runs++;
  else next[n - 1] = true;
  return { bases: next, runs };
}

/**
 * A steal: the lead runner who can advance moves up one base (stealing home scores).
 * Returns null if nobody can steal (bases empty).
 */
export function steal(bases: Bases): { bases: Bases; runs: number; from: number } | null {
  const next: [boolean, boolean, boolean] = [bases[0], bases[1], bases[2]];
  for (let i = 2; i >= 0; i--) {
    if (!bases[i]) continue;
    if (i === 2) {
      next[2] = false;
      return { bases: next, runs: 1, from: 2 };
    }
    if (!bases[i + 1]) {
      next[i] = false;
      next[i + 1] = true;
      return { bases: next, runs: 0, from: i };
    }
  }
  return null;
}

export function runnersOn(bases: Bases): number {
  return (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
}
