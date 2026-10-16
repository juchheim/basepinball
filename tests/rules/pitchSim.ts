import { defaultParams } from '../../src/physics/params';
import { World } from '../../src/physics/world';
import type { PitchSpec } from '../../src/rules/pitching';
import { v1Table } from '../../src/table/v1Table';

export interface PitchOutcome {
  /** Fraction along the bat (0 = pivot, 1 = tip) of first flipper contact, or null. */
  contact: number | null;
  side: 'L' | 'R' | null;
  /** Seconds from release to first flipper contact. */
  time: number | null;
  /** Events before first flipper contact (should be none). */
  before: string[];
  drained: boolean;
}

/** Simulate a pitch with no swing. */
export function simulatePitch(spec: PitchSpec): PitchOutcome {
  const w = new World(v1Table, defaultParams());
  w.pitchBall(spec.targetX, spec.targetY, spec.speed);
  const b = w.balls[0]!;
  const out = { d: 0, nx: 0, ny: 0 };
  const res: PitchOutcome = { contact: null, side: null, time: null, before: [], drained: false };
  for (let i = 0; i < 4000 && b.active; i++) {
    const t = i / 1000;
    if (spec.curve) {
      const on = t >= spec.curve.delay && t < spec.curve.delay + spec.curve.duration;
      w.setMagnet('magnet.curve', on ? spec.curve.power : 0);
    }
    w.step();
    for (const e of w.events) {
      if (e.type === 'drain') res.drained = true;
      // A take is the first flipper touch itself (the no-swing pitch reaching the resting bat).
      else if (res.contact === null && e.type !== 'eos' && e.type !== 'take')
        res.before.push(`${e.type}:${e.id}`);
    }
    w.events.length = 0;
    if (res.contact === null) {
      for (const f of w.flippers) {
        f.distance(b.px, b.py, out);
        if (out.d < b.radius + 0.0005) {
          const cx = b.px - out.nx * b.radius;
          const cy = b.py - out.ny * b.radius;
          const along = (cx - f.px) * Math.cos(f.theta) + (cy - f.py) * Math.sin(f.theta);
          res.contact = along / f.length;
          res.time = t;
          res.side = f.id.endsWith('.L') ? 'L' : 'R';
        }
      }
    }
  }
  return res;
}
