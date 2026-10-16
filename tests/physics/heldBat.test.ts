import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent } from '../../src/physics/world';
import { buildPitch, TEMPLATES, type PitchType, type Side } from '../../src/rules/pitching';
import { v1Table } from '../../src/table/v1Table';

// A pitch that meets a bat held out is a bunt (docs/MVP/01 § 4.1). The physics reports a `bunt`
// when a pitched ball no swing has struck yet touches a flipper that has finished its stroke on
// this press, and never for a swing: a struck ball always leaves the bat before its stroke ends.

/** Pitch at a flipper, pressing it at `pressAt` s after release (held for `holdFor` s). */
function pitchAt(
  type: PitchType,
  side: Side,
  pressAt: number,
  holdFor: number,
  seed = 1,
): { events: PhysicsEvent[]; contact: 'swing' | 'settling' | 'held' | null } {
  const w = new World(v1Table, defaultParams());
  const spec = buildPitch(TEMPLATES[type], side, 5, new Rng(seed));
  w.pitchBall(spec.targetX, spec.targetY, spec.speed);
  const f = w.flippers.find((x) => x.id === `flipper.${side}`)!;
  const events: PhysicsEvent[] = [];
  let contact: 'swing' | 'settling' | 'held' | null = null;
  for (let i = 0; i < 2000; i++) {
    const t = i / 1000;
    if (spec.curve) {
      const on = t >= spec.curve.delay && t < spec.curve.delay + spec.curve.duration;
      w.setMagnet('magnet.curve', on ? spec.curve.power : 0);
    }
    w.setFlipper(f.id, t >= pressAt && t < pressAt + holdFor);
    // The first touch with the button held: on the way up (a swing), on the bat held out, or in
    // the moment between (the bat just arrived at its stop: a bunt only if the ball stays on it).
    const at = f.heldFor < 0 ? 'swing' : f.heldOut ? 'held' : 'settling';
    w.step();
    if (contact === null && w.events.some((e) => e.type === 'swing' && e.id === f.id)) contact = at;
    events.push(...w.events);
    w.events.length = 0;
  }
  return { events, contact };
}

const bunts = (events: PhysicsEvent[]) => events.filter((e) => e.type === 'bunt');
const TYPES: PitchType[] = ['FB', 'CH', 'CB'];
const SIDES: Side[] = ['L', 'R'];

describe('a bat held out (bunt detection)', () => {
  for (const type of TYPES) {
    for (const side of SIDES) {
      it(`${type} to ${side}: a bat held up through the pitch bunts it on first touch`, () => {
        const { events } = pitchAt(type, side, 0, 2);
        const i = events.findIndex((e) => e.type === 'bunt');
        expect(i).toBeGreaterThanOrEqual(0);
        expect(events[i]!.id).toBe(`flipper.${side}`);
        // At the touch itself (the swing it also is comes first), with nothing else before it: the
        // rules still see a fresh pitch, and no cradle-then-flip can get in ahead of the call.
        const before = events.slice(0, i).filter((e) => e.type !== 'eos');
        expect(before.map((e) => e.type)).toEqual(['swing']);
        expect(events[i]!.time - events[i - 1]!.time).toBeLessThan(0.002);
        expect(bunts(events)).toHaveLength(1);
      });

      it(`${type} to ${side}: every swing that meets the pitch on the way up is no bunt`, () => {
        let swings = 0;
        for (let ms = 150; ms <= 650; ms += 3) {
          const { events, contact } = pitchAt(type, side, ms / 1000, 0.25);
          if (contact === 'swing') {
            swings++;
            expect(bunts(events), `press at ${ms} ms`).toEqual([]);
          } else if (contact === 'held') {
            expect(bunts(events), `press at ${ms} ms`).toHaveLength(1);
          }
        }
        // A fair window to swing in (about 0.1 s of press timing).
        expect(swings).toBeGreaterThan(20);
      });
    }
  }

  it('a struck pitch that comes back to the bat still held up is no bunt', () => {
    // A late swing sends the ball across, it comes back off the far side (no switch on the way)
    // and touches the bat the batter is still holding up after the swing.
    const { events, contact } = pitchAt('FB', 'L', 0.525, 0.25);
    expect(contact).toBe('swing');
    expect(events.filter((e) => e.type === 'swing').length).toBeGreaterThan(1);
    expect(bunts(events)).toEqual([]);
  });

  it('only a pitch bunts: a ball set down on a held bat (a rally cradle) does not', () => {
    const w = new World(v1Table, defaultParams());
    w.setFlipper('flipper.L', true);
    for (let i = 0; i < 200; i++) w.step();
    const f = w.flippers.find((x) => x.id === 'flipper.L')!;
    const along = 0.3 * f.length;
    w.addBall(
      f.px + Math.cos(f.theta) * along,
      f.py + Math.sin(f.theta) * along + f.baseRadius + 0.0135 + 0.002,
    );
    for (let i = 0; i < 2000; i++) w.step();
    expect(bunts(w.events)).toEqual([]);
  });
});
