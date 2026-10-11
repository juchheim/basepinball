import { describe, expect, it } from 'vitest';
import { emptyStats } from '../../src/rules/types';
import { addHighScore, loadHighScores } from '../../src/storage/highscores';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

const stats = (runs: number, hits = 0, hr = 0) => ({ ...emptyStats(), runs, hits, homeRuns: hr });

describe('high scores', () => {
  it('ranks by runs, then hits, then home runs, then the earlier date', () => {
    const s = new MemoryStorage();
    addHighScore('aaa', stats(3, 5), s, new Date('2026-10-01'));
    addHighScore('bbb', stats(3, 7), s, new Date('2026-10-02'));
    addHighScore('ccc', stats(5, 1), s, new Date('2026-10-03'));
    addHighScore('ddd', stats(3, 7), s, new Date('2026-10-04'));
    expect(loadHighScores(s).map((h) => h.initials)).toEqual(['CCC', 'BBB', 'DDD', 'AAA']);
  });

  it('keeps the top 10 and reports the new rank', () => {
    const s = new MemoryStorage();
    for (let i = 0; i < 12; i++) addHighScore('x', stats(i), s);
    const scores = loadHighScores(s);
    expect(scores).toHaveLength(10);
    expect(scores[0]!.runs).toBe(11);
    expect(addHighScore('new', stats(6, 99), s).rank).toBe(5);
    expect(addHighScore('low', stats(0), s).rank).toBe(-1);
  });

  it('survives corrupt or unavailable storage', () => {
    const s = new MemoryStorage();
    s.setItem('bp.v1.highscores', '{not json');
    expect(loadHighScores(s)).toEqual([]);
    expect(loadHighScores(undefined)).toEqual([]);
    const broken = new MemoryStorage();
    broken.setItem = () => {
      throw new Error('quota');
    };
    expect(addHighScore('abc', stats(1), broken).scores).toHaveLength(1);
  });
});
