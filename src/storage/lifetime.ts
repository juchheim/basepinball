import type { GameStats } from '../rules/types';
import { safeStorage } from './settings';

/**
 * Lifetime stats (docs/MVP/01 § 7, P1): games played, best game, total home runs, longest rally
 * ever and batting average, across every completed game on this device. Versioned in
 * localStorage; storage failures just mean nothing is remembered.
 */

export interface Lifetime {
  version: 1;
  games: number;
  bestRuns: number;
  runs: number;
  hits: number;
  plateAppearances: number;
  homeRuns: number;
  strikeouts: number;
  longestRally: number;
  skillShots: number;
}

const KEY = 'bp.v1.lifetime';

export const EMPTY_LIFETIME: Lifetime = {
  version: 1,
  games: 0,
  bestRuns: 0,
  runs: 0,
  hits: 0,
  plateAppearances: 0,
  homeRuns: 0,
  strikeouts: 0,
  longestRally: 0,
  skillShots: 0,
};

export function loadLifetime(storage: Storage | undefined = safeStorage()): Lifetime {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...EMPTY_LIFETIME };
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out = { ...EMPTY_LIFETIME };
    for (const k of Object.keys(EMPTY_LIFETIME) as (keyof Lifetime)[]) {
      if (k === 'version') continue;
      const v = o[k];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return { ...EMPTY_LIFETIME };
  }
}

/** Fold a finished game into the lifetime totals and save them. */
export function recordGame(
  stats: GameStats,
  storage: Storage | undefined = safeStorage(),
): Lifetime {
  const l = loadLifetime(storage);
  const next: Lifetime = {
    version: 1,
    games: l.games + 1,
    bestRuns: Math.max(l.bestRuns, stats.runs),
    runs: l.runs + stats.runs,
    hits: l.hits + stats.hits,
    plateAppearances: l.plateAppearances + stats.plateAppearances,
    homeRuns: l.homeRuns + stats.homeRuns,
    strikeouts: l.strikeouts + stats.strikeouts,
    longestRally: Math.max(l.longestRally, stats.longestRally),
    skillShots: l.skillShots + stats.skillShots,
  };
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saved.
  }
  return next;
}

/** Batting average (hits / PA) as baseball writes it: ".287". */
export function battingAverage(l: Lifetime): string {
  if (l.plateAppearances === 0) return '.000';
  const thousandths = Math.round((l.hits / l.plateAppearances) * 1000);
  return thousandths >= 1000 ? '1.000' : `.${String(thousandths).padStart(3, '0')}`;
}
