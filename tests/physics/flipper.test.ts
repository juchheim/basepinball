import { describe, expect, it } from 'vitest';
import { flipper, makeWorld, pointAbove, runFor } from './helpers';
import type { World } from '../../src/physics/world';

// Feel suite #3 (cradle stability) and #4 (flipper shot repeatability).

function cradle(id: 'flipper.L' | 'flipper.R') {
  const w = makeWorld();
  const f = flipper(w, id);
  w.setFlipper(id, true);
  runFor(w, 0.1);
  const pt = pointAbove(f, 0.7, w.params.ballRadius);
  const b = w.addBall(pt.x, pt.y + 0.01);
  runFor(w, 2);
  return { w, b };
}

/** Ball resting on the bat at fraction `s` of its length, then the flipper fires. */
function shot(s: number, id: 'flipper.L' | 'flipper.R' = 'flipper.L') {
  const w = makeWorld();
  const f = flipper(w, id);
  const pt = pointAbove(f, s, w.params.ballRadius);
  const b = w.addBall(pt.x, pt.y);
  w.setFlipper(id, true);
  let speed = 0;
  let angle = 0;
  runFor(w, 0.08, () => {
    const v = Math.hypot(b.vx, b.vy);
    if (v > speed) {
      speed = v;
      angle = (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
    }
  });
  return { speed, angle, w };
}

function snapshot(w: World): number[] {
  const b = w.balls[0]!;
  return [b.px, b.py, b.pz, b.vx, b.vy, b.vz, b.wx, b.wy, b.wz, ...w.flippers.map((f) => f.theta)];
}

describe('cradle stability', () => {
  for (const id of ['flipper.L', 'flipper.R'] as const) {
    it(`holds the ball still on ${id} for 10 s`, () => {
      const { w, b } = cradle(id);
      expect(b.active).toBe(true);
      const x0 = b.px;
      const y0 = b.py;
      let maxDrift = 0;
      runFor(w, 10, () => {
        maxDrift = Math.max(maxDrift, Math.hypot(b.px - x0, b.py - y0));
      });
      expect(b.active).toBe(true);
      expect(maxDrift).toBeLessThan(0.0005);
      expect(b.speed()).toBeLessThan(0.01);
    });
  }
});

describe('flipper shots', () => {
  it('are bit-for-bit repeatable', () => {
    for (const s of [0.3, 0.6, 0.85]) {
      const a = shot(s);
      const b = shot(s);
      expect(snapshot(a.w)).toEqual(snapshot(b.w));
    }
  });

  it('produce plausible speeds and a smooth angle map along the bat', () => {
    const fractions = [0.25, 0.4, 0.55, 0.7, 0.85];
    const results = fractions.map((s) => shot(s));
    for (const r of results) {
      expect(r.speed).toBeGreaterThan(2.5);
      expect(r.speed).toBeLessThan(9);
    }
    // Left flipper: the further out the contact, the further right the ball goes.
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.angle).toBeLessThanOrEqual(results[i - 1]!.angle + 0.5);
    }
  });

  it('mirror between left and right flippers', () => {
    for (const s of [0.4, 0.7]) {
      const l = shot(s, 'flipper.L');
      const r = shot(s, 'flipper.R');
      expect(Math.abs(l.speed - r.speed)).toBeLessThan(0.01);
      expect(Math.abs(l.angle - (180 - r.angle))).toBeLessThan(0.5);
    }
  });
});
