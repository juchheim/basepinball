import { describe, expect, it } from 'vitest';
import { dcos, dsin, DEG } from '../../src/core/dmath';
import { emptyTable, flipper, makeWorld, runFor } from './helpers';
import type { ElementDef } from '../../src/table/schema';

// Feel suite #1 (docs/MVP/03-physics.md § 9): balls fired at 2-20 m/s at every collider type must
// never end up inside or on the far side of it.

const SPEEDS = [2, 5, 8, 12, 16, 20];
const ANGLES = [25, 45, 70, 90, 110, 135, 155];

function fire(elements: ElementDef[], from: { x: number; y: number }, speed: number, angleDeg: number) {
  const w = makeWorld(emptyTable(elements));
  const b = w.addBall(from.x, from.y);
  b.vx = speed * dcos(angleDeg * DEG);
  b.vy = speed * dsin(angleDeg * DEG);
  return { w, b };
}

describe('no tunneling', () => {
  it('through a wall segment', () => {
    const wallY = 0.4;
    const limit = wallY - 0.0135 - 0.0015 + 0.0005; // ball radius + wall half-thickness, 0.5 mm tolerance
    for (const speed of SPEEDS) {
      for (const angle of ANGLES) {
        const { w, b } = fire(
          [{ type: 'wall', points: [[0, 400], [600, 400]], material: 'metal' }],
          { x: 0.3, y: 0.33 },
          speed,
          angle,
        );
        runFor(w, 0.1, () => expect(b.py).toBeLessThan(limit));
      }
    }
  });

  it('through a thin post', () => {
    const r = 0.005;
    for (const speed of SPEEDS) {
      for (const angle of ANGLES) {
        // Aim at the post from 70 mm away, offset by the angle.
        const a = (angle - 90) * DEG;
        const start = { x: 0.3 - 0.07 * dsin(a), y: 0.4 - 0.07 * dcos(a) };
        const { w, b } = fire([{ type: 'post', x: 300, y: 400, radius: 5, material: 'rubberPost' }], start, speed, angle);
        runFor(w, 0.05, () => {
          const d = Math.hypot(b.px - 0.3, b.py - 0.4);
          expect(d).toBeGreaterThan(r + 0.0135 - 0.0005);
        });
      }
    }
  });

  it('through a raised drop target', () => {
    for (const speed of SPEEDS) {
      for (const angle of ANGLES) {
        const { w, b } = fire(
          [{ type: 'drop', id: 'd', a: [100, 400], b: [500, 400] }],
          { x: 0.3, y: 0.33 },
          speed,
          angle,
        );
        // The first hit may knock it down; until then the ball must stay in front.
        runFor(w, 0.1, () => {
          if (!w.isDropDown('d')) expect(b.py).toBeLessThan(0.4 - 0.0135 - 0.0025 + 0.0005);
        });
      }
    }
  });

  it('through a moving flipper', () => {
    const out = { d: 0, nx: 0, ny: 0 };
    for (const speed of [2, 5, 8, 12, 16]) {
      for (const dx of [-0.02, 0, 0.02, 0.04, 0.06]) {
        for (const pressDelayMs of [0, 5, 10, 20]) {
          const w = makeWorld();
          const f = flipper(w, 'flipper.L');
          // Fire straight down at a point along the bat.
          const b = w.addBall(f.px + 0.02 + dx, f.py + 0.06);
          b.vy = -speed;
          let t = 0;
          runFor(w, 0.06, () => {
            t += 1;
            if (t === pressDelayMs) w.setFlipper('flipper.L', true);
            if (!b.active) return;
            f.distance(b.px, b.py, out);
            expect(out.d).toBeGreaterThan(b.radius - 0.0008);
          });
        }
      }
    }
  });
});
