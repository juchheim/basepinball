import type { GameStats } from '../rules/types';

/**
 * Local high scores (docs/MVP/04 § 8): top 10 in localStorage, versioned. Ranked by runs, then
 * hits, then home runs, then the earlier date. Storage failures (private mode, quota) are
 * swallowed: the game still runs, it just does not remember.
 */

export interface HighScore {
  initials: string;
  runs: number;
  hits: number;
  hr: number;
  date: string;
  durationSec: number;
  build: string;
}

const KEY = 'bp.v1.highscores';
const MAX = 10;

export function compare(a: HighScore, b: HighScore): number {
  return b.runs - a.runs || b.hits - a.hits || b.hr - a.hr || a.date.localeCompare(b.date);
}

export function loadHighScores(storage: Storage | undefined = safeStorage()): HighScore[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHighScore).sort(compare).slice(0, MAX);
  } catch {
    return [];
  }
}

/** Would these stats make the table? */
export function qualifies(stats: GameStats, scores = loadHighScores()): boolean {
  if (scores.length < MAX) return true;
  const candidate = entry('???', stats, new Date(8.64e15).toISOString());
  return compare(candidate, scores[scores.length - 1]!) < 0;
}

/** Add an entry; returns the new table and the entry's rank (0-based, or -1 if it missed). */
export function addHighScore(
  initials: string,
  stats: GameStats,
  storage: Storage | undefined = safeStorage(),
  now = new Date(),
): { scores: HighScore[]; rank: number } {
  const e = entry(initials, stats, now.toISOString());
  const scores = [...loadHighScores(storage), e].sort(compare).slice(0, MAX);
  try {
    storage?.setItem(KEY, JSON.stringify(scores));
  } catch {
    // Not saved; still show it this session.
  }
  return { scores, rank: scores.indexOf(e) };
}

function entry(initials: string, stats: GameStats, date: string): HighScore {
  return {
    initials: initials.toUpperCase().slice(0, 3).padEnd(3, ' '),
    runs: stats.runs,
    hits: stats.hits,
    hr: stats.homeRuns,
    date,
    durationSec: Math.round(stats.duration),
    build: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
  };
}

function isHighScore(v: unknown): v is HighScore {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  return (
    typeof h.initials === 'string' &&
    typeof h.runs === 'number' &&
    typeof h.hits === 'number' &&
    typeof h.date === 'string'
  );
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
