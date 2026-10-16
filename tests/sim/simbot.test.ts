import { describe, expect, it } from 'vitest';
import { PROFILES, playGame } from '../../src/sim/bot';

// The sim bot plays complete games headlessly (docs/MVP/04 § 9). This suite checks that games
// always finish and stay in a sane range; `npm run simbot` prints the full balance report.

describe('sim bot', () => {
  it('plays complete 9-inning games with no rescues and sensible results', () => {
    const games = Array.from({ length: 6 }, (_, i) => playGame(PROFILES.average!, 2000 + i));
    for (const g of games) {
      expect(g.completed).toBe(true);
      expect(g.rescues).toBe(0);
      expect(g.stats.plateAppearances).toBeGreaterThanOrEqual(27);
      const s = g.stats;
      expect(s.strikeouts + s.foulOuts + s.fielderOuts + s.tiltOuts + s.buntOuts).toBe(27);
    }
    const runs = games.reduce((a, g) => a + g.stats.runs, 0) / games.length;
    const pa = games.reduce((a, g) => a + g.stats.plateAppearances, 0);
    const hits = games.reduce((a, g) => a + g.stats.hits, 0);
    // Loose bounds (6 games); the balance report runs larger samples.
    expect(runs).toBeGreaterThan(1);
    expect(runs).toBeLessThan(10);
    expect(hits / pa).toBeGreaterThan(0.15);
    expect(hits / pa).toBeLessThan(0.45);
  });

  it('is deterministic for a seed', () => {
    const a = playGame(PROFILES.average!, 77);
    const b = playGame(PROFILES.average!, 77);
    expect(a.stats).toEqual(b.stats);
  });

  it('flipping matters: a player who never reacts scores less', () => {
    const idle = { name: 'idle', jitter: 0, attention: 0, cradle: 0 };
    const runs = (p: typeof idle) =>
      Array.from({ length: 4 }, (_, i) => playGame(p, 3000 + i).stats.runs).reduce(
        (a, b) => a + b,
        0,
      );
    expect(runs(idle)).toBeLessThan(runs(PROFILES.average!));
  });
});
