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

/**
 * A walk: the batter takes first base and only the runners forced by him advance. With the bases
 * loaded the runner on third is forced home, so a run scores. `moved` lists the bases (0 = first)
 * whose runners advanced.
 */
export function walk(bases: Bases): { bases: Bases; runs: number; moved: number[] } {
  if (!bases[0]) return { bases: [true, bases[1], bases[2]], runs: 0, moved: [] };
  if (!bases[1]) return { bases: [true, true, bases[2]], runs: 0, moved: [0] };
  if (!bases[2]) return { bases: [true, true, true], runs: 0, moved: [0, 1] };
  return { bases: [true, true, true], runs: 1, moved: [0, 1, 2] };
}

/**
 * Every runner takes the next base at once (the runner on third scores). Returns null if nobody is
 * on base. `moved` lists the bases (0 = first) whose runners advanced.
 */
export function advanceAll(bases: Bases): { bases: Bases; runs: number; moved: number[] } | null {
  if (!bases[0] && !bases[1] && !bases[2]) return null;
  const moved = [0, 1, 2].filter((i) => bases[i]);
  return { bases: [false, bases[0], bases[1]], runs: bases[2] ? 1 : 0, moved };
}

export function runnersOn(bases: Bases): number {
  return (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
}
