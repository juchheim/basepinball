import { Rng } from '../core/rng';
import { advance, EMPTY, walk, type Bases } from './bases';

export type GameMode = 'single' | 'vs-ai';
export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface OpponentInning {
  inning: number;
  runs: number;
  hits: number;
}

export interface OpponentScore {
  difficulty: AiDifficulty;
  /** Null marks an inning the opponent has not played yet. */
  runsByInning: (number | null)[];
  hitsByInning: (number | null)[];
  runs: number;
  hits: number;
}

interface BattingProfile {
  walkRate: number;
  hitRate: number;
  doubleRate: number;
  tripleRate: number;
  homeRunRate: number;
}

const PROFILES: Record<AiDifficulty, BattingProfile> = {
  easy: { walkRate: 0.05, hitRate: 0.2, doubleRate: 0.15, tripleRate: 0.025, homeRunRate: 0.025 },
  medium: {
    walkRate: 0.07,
    hitRate: 0.255,
    doubleRate: 0.19,
    tripleRate: 0.035,
    homeRunRate: 0.055,
  },
  hard: { walkRate: 0.085, hitRate: 0.31, doubleRate: 0.23, tripleRate: 0.04, homeRunRate: 0.095 },
};

/**
 * Local opponent for Vs AI mode. Each call simulates one baseball half-inning, independently of
 * the pinball rules RNG, until three outs. It is intentionally separate from the physics-playing
 * developer bot in `sim/bot.ts`.
 */
export class AiOpponent {
  private readonly rng: Rng;
  private readonly innings: (OpponentInning | null)[] = Array.from({ length: 9 }, () => null);

  constructor(
    readonly difficulty: AiDifficulty,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  playInning(inning: number): OpponentInning {
    if (!Number.isInteger(inning) || inning < 1 || inning > 9)
      throw new RangeError(`Invalid opponent inning: ${inning}`);

    const existing = this.innings[inning - 1];
    if (existing) return existing;

    const profile = PROFILES[this.difficulty];
    let outs = 0;
    let runs = 0;
    let hits = 0;
    let bases: Bases = EMPTY;
    let plateAppearances = 0;

    // The guard is unreachable with these probabilities; it keeps a bad profile from hanging a
    // game if difficulty data is changed later.
    while (outs < 3 && plateAppearances < 100) {
      plateAppearances++;
      const outcome = this.rng.next();

      if (outcome < profile.walkRate) {
        const result = walk(bases);
        bases = result.bases;
        runs += result.runs;
      } else if (outcome < profile.walkRate + profile.hitRate) {
        const hitRoll = this.rng.next();
        const hitBases =
          hitRoll < profile.homeRunRate
            ? 4
            : hitRoll < profile.homeRunRate + profile.tripleRate
              ? 3
              : hitRoll < profile.homeRunRate + profile.tripleRate + profile.doubleRate
                ? 2
                : 1;
        const result = advance(bases, hitBases);
        bases = result.bases;
        runs += result.runs;
        hits++;
      } else {
        outs++;
      }
    }

    const result = { inning, runs, hits };
    this.innings[inning - 1] = result;
    return result;
  }

  snapshot(): OpponentScore {
    const completed = this.innings.filter((inning): inning is OpponentInning => inning !== null);
    return {
      difficulty: this.difficulty,
      runsByInning: this.innings.map((inning) => inning?.runs ?? null),
      hitsByInning: this.innings.map((inning) => inning?.hits ?? null),
      runs: completed.reduce((total, inning) => total + inning.runs, 0),
      hits: completed.reduce((total, inning) => total + inning.hits, 0),
    };
  }
}
