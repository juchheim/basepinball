export type GameMode = 'single' | 'vs-ai';
export type AiDifficulty = 'easy' | 'medium' | 'hard';
export type BattingSide = 'human' | 'ai';

/**
 * The innings a line score shows: the regulation length, growing by one column for each extra
 * inning played. Past `maxColumns` it keeps the latest ones, as a ballpark board does once the
 * game outlasts its columns.
 */
export function lineScoreInnings(
  current: number,
  regulation: number,
  maxColumns = Infinity,
): number[] {
  const last = Math.max(regulation, current);
  const first = Math.max(1, last - maxColumns + 1);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** "10th", "11th", "12th", "21st", "22nd"... */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}
