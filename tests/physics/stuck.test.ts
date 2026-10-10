import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { makeWorld } from './helpers';

// Whitebox checklist item (docs/MVP/02 § 9): no stuck-ball spots. Random balls are thrown into the
// open playfield with flippers idle, flicking randomly, or held; a ball that sits still for 2 s with
// no flipper held (a cradle is intentional) and not in a saucer is stuck.

describe('stuck balls', () => {
  it('never come to rest anywhere except a cradle or a saucer', () => {
    const rng = new Rng(99);
    const stuck: string[] = [];
    for (let trial = 0; trial < 150; trial++) {
      const w = makeWorld();
      const b = w.addBall(rng.range(0.03, 0.52), rng.range(0.42, 0.72));
      b.vx = rng.range(-3, 3);
      b.vy = rng.range(-3, 2);
      const mode = trial % 3; // 0: never flip, 1: random flips, 2: hold left
      if (mode === 2) w.setFlipper('flipper.L', true);
      let still = 0;
      for (let i = 0; i < 15000 && b.active; i++) {
        if (mode === 1 && i % 300 === 0) {
          w.setFlipper('flipper.L', rng.next() < 0.3);
          w.setFlipper('flipper.R', rng.next() < 0.3);
        }
        w.step();
        w.events.length = 0;
        if (w.saucers.some((s) => s.holding)) break;
        still = b.speed() < 0.01 ? still + 1 : 0;
        if (still > 2000) {
          if (!w.flippers.some((f) => f.pressed)) {
            stuck.push(
              `trial ${trial} at (${(b.px * 1000).toFixed(0)}, ${(b.py * 1000).toFixed(0)}) mm`,
            );
          }
          break;
        }
      }
    }
    expect(stuck).toEqual([]);
  });
});
