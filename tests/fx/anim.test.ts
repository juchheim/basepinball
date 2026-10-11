import { describe, expect, it } from 'vitest';
import { Spring, Timeline } from '../../src/fx/anim';

describe('animation kit', () => {
  it('a kicked spring overshoots, then settles back to rest', () => {
    const s = new Spring(12, 0.35);
    s.kick(50);
    let max = 0;
    let min = 0;
    for (let i = 0; i < 120; i++) {
      s.update(1 / 60);
      max = Math.max(max, s.x);
      min = Math.min(min, s.x);
    }
    expect(max).toBeGreaterThan(0.3);
    expect(min).toBeLessThan(0); // overshoot past rest
    expect(s.settled).toBe(true);
  });

  it('is stable at a low frame rate', () => {
    const s = new Spring(14, 0.3);
    s.kick(90);
    for (let i = 0; i < 20; i++) s.update(0.1);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });

  it('timeline runs callbacks and tweens in order', () => {
    const tl = new Timeline();
    const seen: string[] = [];
    let last = 0;
    tl.after(0.2, () => seen.push('b'));
    tl.after(0.1, () => seen.push('a'));
    tl.tween(0.5, (k) => (last = k));
    for (let i = 0; i < 40; i++) tl.update(1 / 60);
    expect(seen).toEqual(['a', 'b']);
    expect(last).toBe(1);
  });
});
