import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { makeWorld } from './helpers';

// Budget (docs/MVP/04 § 6): < 1 ms of physics per 16.7 ms frame, i.e. < ~58 µs per 1 kHz step.
// Node on a dev machine is faster than a mid-range phone, so we hold it to a tighter 20 µs.

function measure(): number {
  const w = makeWorld();
  const rng = new Rng(7);
  let b = w.addBall(0.275, 0.7);
  const steps = 20_000;
  // Warm up the JIT.
  for (let i = 0; i < 3000; i++) w.step();
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    // Flip both flippers in a rhythm and respawn drained balls to keep things busy.
    const phase = i % 400;
    w.setFlipper('flipper.L', phase < 120);
    w.setFlipper('flipper.R', phase > 200 && phase < 320);
    if (!b.active) {
      w.balls.length = 0;
      b = w.addBall(rng.range(0.1, 0.45), 0.7);
      b.vx = rng.range(-2, 2);
    }
    w.events.length = 0;
    w.step();
  }
  return ((performance.now() - t0) * 1000) / steps;
}

describe('physics performance', () => {
  it('steps well inside the frame budget during active play', () => {
    // Best of three runs, so a busy machine (other test workers, a browser) does not fail the build.
    const runs = [0, 1, 2].map(() => measure());
    const perStepUs = Math.min(...runs);
    console.log(
      `physics: ${perStepUs.toFixed(2)} µs/step, ${(perStepUs * 16.7).toFixed(0)} µs per 60 Hz frame`,
    );
    expect(perStepUs).toBeLessThan(20);
  });
});
