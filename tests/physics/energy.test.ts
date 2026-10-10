import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { makeWorld, runFor } from './helpers';

// Feel suite #2: with no actuators firing (slings, pops, flippers idle), the ball's total
// mechanical energy must never increase.

describe('energy sanity', () => {
  it('never gains energy without actuators', () => {
    const rng = new Rng(1234);
    for (let trial = 0; trial < 40; trial++) {
      const w = makeWorld();
      w.actuatorsEnabled = false;
      const b = w.addBall(rng.range(0.1, 0.45), rng.range(0.45, 0.7));
      b.vx = rng.range(-3, 3);
      b.vy = rng.range(-3, 1);
      // Settle any overlap with a collider at the random spawn point first.
      w.step();
      // Energy may only go down: every value must stay below the lowest value seen so far.
      // Flipper kinetic and spring energy is included, since a bat hit by the ball stores and
      // returns some of the ball's energy.
      let minE = w.totalEnergy();
      runFor(w, 4, () => {
        if (!b.active) return;
        const e = w.totalEnergy();
        // 0.1 mJ tolerance for positional correction (the ball's energy is ~50-400 mJ).
        expect(e).toBeLessThan(minE + 1e-4);
        minE = Math.min(minE, e);
      });
    }
  });
});
