import { describe, expect, it } from 'vitest';
import { PLAYER_PROFILES, PROFILES, playGame } from '../../src/sim/bot';

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
    // Loose bounds (6 games); the balance report runs larger samples. This is a sanity check,
    // not the 5-7 balance target. The bot shares its flipper controller with the vs-AI
    // opponent, and that controller's rework (374849a onward: a missed reaction is a true miss
    // instead of a flip a second later that also ignored every other ball) made it a stronger
    // player. 60-game means (`npm run simbot -- 60`): 9.28 before the rework, 10.93 after. These
    // six seeds give 11.17, so the old < 10 bound sat inside the bot's normal range.
    expect(runs).toBeGreaterThan(1);
    expect(runs).toBeLessThan(15);
    expect(hits / pa).toBeGreaterThan(0.15);
    expect(hits / pa).toBeLessThan(0.45);
  });

  it('is deterministic for a seed', () => {
    const a = playGame(PROFILES.average!, 77);
    const b = playGame(PROFILES.average!, 77);
    expect(a.stats).toEqual(b.stats);
  });

  it('the Vs AI levels are ordered: Easy scores well below Hard', () => {
    // Targets (01 § 8): Easy 5-7, Hard 10-15 runs a game; 200-game means are 6.21 and 13.25. A
    // game's runs vary by about 4 either way, so this is a 10-game regression check (these seeds
    // give 6.1 and 13.3), not the balance target: `npm run simbot -- 200 easy` is.
    const runs = (level: keyof typeof PLAYER_PROFILES) =>
      Array.from({ length: 10 }, (_, i) => playGame(PLAYER_PROFILES[level], 4100 + i)).reduce(
        (a, g) => a + g.stats.runs,
        0,
      ) / 10;
    const easy = runs('easy');
    expect(easy).toBeLessThan(8);
    expect(easy).toBeLessThan(runs('hard') - 4);
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
