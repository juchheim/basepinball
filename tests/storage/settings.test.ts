import { describe, expect, it } from 'vitest';
import type { GameStats } from '../../src/rules/types';
import { battingAverage, loadLifetime, recordGame } from '../../src/storage/lifetime';
import {
  bindKey,
  DEFAULT_SETTINGS,
  loadSettings,
  sanitize,
  saveSettings,
} from '../../src/storage/settings';

// Acceptance criterion 7 (docs/MVP/07 § 5): settings and stats persist across reloads and fail
// safely in private mode.

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

/** Safari private mode (old) and full quota: every write throws. */
class BrokenStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException('QuotaExceededError');
  }
  override getItem(): string | null {
    throw new DOMException('SecurityError');
  }
}

const stats = (o: Partial<GameStats>): GameStats =>
  ({
    runs: 0,
    hits: 0,
    plateAppearances: 0,
    homeRuns: 0,
    strikeouts: 0,
    longestRally: 0,
    skillShots: 0,
    ...o,
  }) as GameStats;

describe('settings storage', () => {
  it('round-trips through storage', () => {
    const st = new MemoryStorage();
    const s = { ...DEFAULT_SETTINGS, hudScale: 'large' as const, muted: true };
    saveSettings(s, st);
    expect(loadSettings(st)).toEqual(s);
  });

  it('falls back to defaults when storage throws (private mode) or is missing', () => {
    expect(loadSettings(new BrokenStorage())).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, new BrokenStorage())).not.toThrow();
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps what is valid from damaged data', () => {
    const s = sanitize({
      volume: { master: 3, sfx: 'loud', crowd: 0.2 },
      hudScale: 'huge',
      quality: 'medium',
      keys: { flipperL: ['KeyQ'], flipperR: 'nope', pause: [] },
    });
    expect(s.volume).toEqual({ master: 1, sfx: 1, crowd: 0.2, music: 0.6 });
    expect(s.hudScale).toBe('normal');
    expect(s.quality).toBe('medium');
    expect(s.graphics).toBe('auto');
    expect(sanitize({ graphics: 'compat' }).graphics).toBe('compat');
    expect(sanitize({ graphics: 'nonsense' }).graphics).toBe('auto');
    expect(sanitize({ frameRate: '60' }).frameRate).toBe('60');
    expect(sanitize({ frameRate: 120 }).frameRate).toBe('auto');
    expect(sanitize({ batterySaver: true }).batterySaver).toBe(true);
    expect(sanitize({ batterySaver: 'yes' }).batterySaver).toBe(false);
    expect(s.keys.flipperL).toEqual(['KeyQ']);
    expect(s.keys.flipperR).toEqual(DEFAULT_SETTINGS.keys.flipperR);
    expect(s.keys.pause).toEqual(DEFAULT_SETTINGS.keys.pause);
    expect(sanitize('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('binding a key takes it from any other action', () => {
    const s = bindKey(DEFAULT_SETTINGS, 'nudgeUp', 'ShiftLeft');
    expect(s.keys.nudgeUp[0]).toBe('ShiftLeft');
    expect(s.keys.flipperL).not.toContain('ShiftLeft');
    expect(DEFAULT_SETTINGS.keys.flipperL).toContain('ShiftLeft'); // defaults untouched
  });
});

describe('lifetime stats', () => {
  it('accumulates games', () => {
    const st = new MemoryStorage();
    recordGame(stats({ runs: 4, hits: 9, plateAppearances: 30, homeRuns: 1, longestRally: 3 }), st);
    const l = recordGame(stats({ runs: 7, hits: 11, plateAppearances: 33, longestRally: 2 }), st);
    expect(l.games).toBe(2);
    expect(l.bestRuns).toBe(7);
    expect(l.runs).toBe(11);
    expect(l.homeRuns).toBe(1);
    expect(l.longestRally).toBe(3);
    expect(loadLifetime(st)).toEqual(l);
    expect(battingAverage(l)).toBe('.317');
  });

  it('fails safely without storage', () => {
    expect(() => recordGame(stats({ runs: 1 }), new BrokenStorage())).not.toThrow();
    expect(loadLifetime(new BrokenStorage()).games).toBe(0);
  });

  it('formats batting averages like a box score', () => {
    const l = loadLifetime(undefined);
    expect(battingAverage(l)).toBe('.000');
    expect(battingAverage({ ...l, hits: 1, plateAppearances: 1 })).toBe('1.000');
    expect(battingAverage({ ...l, hits: 9999, plateAppearances: 10000 })).toBe('1.000');
    expect(battingAverage({ ...l, hits: 1, plateAppearances: 40 })).toBe('.025');
  });
});
