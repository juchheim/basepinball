import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent } from '../../src/physics/world';
import { buildPitch, TEMPLATES, type PitchType, type Side } from '../../src/rules/pitching';
import { v1Table } from '../../src/table/v1Table';

// A cradled pitch is a bunt (docs/MVP/01 § 4.1). The physics reports a cradle (a ball held still on
// a raised flipper for 0.3 s) once per spell, and never for a swing that sends the ball away.

/** Pitch at a flipper, pressing it at `pressAt` s after release (held for `holdFor` s). */
function pitchAt(
  type: PitchType,
  side: Side,
  pressAt: number,
  holdFor: number,
  seed = 1,
): PhysicsEvent[] {
  const w = new World(v1Table, defaultParams());
  const spec = buildPitch(TEMPLATES[type], side, 5, new Rng(seed));
  w.pitchBall(spec.targetX, spec.targetY, spec.speed);
  const id = `flipper.${side}`;
  const seen: PhysicsEvent[] = [];
  for (let i = 0; i < 3000; i++) {
    const t = i / 1000;
    if (spec.curve) {
      const on = t >= spec.curve.delay && t < spec.curve.delay + spec.curve.duration;
      w.setMagnet('magnet.curve', on ? spec.curve.power : 0);
    }
    w.setFlipper(id, t >= pressAt && t < pressAt + holdFor);
    w.step();
    seen.push(...w.events);
    w.events.length = 0;
  }
  return seen;
}

const TYPES: PitchType[] = ['FB', 'CH', 'CB'];
const SIDES: Side[] = ['L', 'R'];

describe('cradle detection', () => {
  it('a ball set down on a raised bat is cradled once, after it settles', () => {
    const w = new World(v1Table, defaultParams());
    w.setFlipper('flipper.L', true);
    for (let i = 0; i < 200; i++) w.step();
    const f = w.flippers.find((x) => x.id === 'flipper.L')!;
    const along = 0.3 * f.length;
    w.addBall(
      f.px + Math.cos(f.theta) * along,
      f.py + Math.sin(f.theta) * along + f.baseRadius + 0.0135 + 0.002,
    );
    const start = w.time;
    const cradles: PhysicsEvent[] = [];
    for (let i = 0; i < 3000; i++) {
      w.step();
      cradles.push(...w.events.filter((e) => e.type === 'cradle'));
      w.events.length = 0;
    }
    expect(cradles).toHaveLength(1);
    expect(cradles[0]!.id).toBe('flipper.L');
    expect(cradles[0]!.time - start).toBeGreaterThanOrEqual(0.3);
  });

  for (const type of TYPES) {
    for (const side of SIDES) {
      it(`${type} to ${side}: holding the bat up through the pitch cradles it, touching nothing else`, () => {
        const events = pitchAt(type, side, 0, 3);
        const i = events.findIndex((e) => e.type === 'cradle');
        expect(i).toBeGreaterThanOrEqual(0);
        expect(events[i]!.id).toBe(`flipper.${side}`);
        // Nothing but the bat before it: the rules still see a fresh pitch, so it is a bunt.
        const before = events.slice(0, i).filter((e) => e.type !== 'eos' && e.type !== 'swing');
        expect(before).toEqual([]);
        expect(events.filter((e) => e.type === 'cradle')).toHaveLength(1);
      });

      it(`${type} to ${side}: a swing that lets go is never a cradle`, () => {
        // Press as the ball arrives and let go 0.15 s later: a flip, however it is timed.
        for (const pressAt of [0.25, 0.3, 0.35, 0.4, 0.45]) {
          const events = pitchAt(type, side, pressAt, 0.15);
          expect(
            events.filter((e) => e.type === 'cradle'),
            `press at ${pressAt}`,
          ).toEqual([]);
        }
      });
    }
  }
});
