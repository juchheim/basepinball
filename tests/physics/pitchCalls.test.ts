import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent } from '../../src/physics/world';
import { buildPitch, TEMPLATES, type PitchType, type Side } from '../../src/rules/pitching';
import { v1Table } from '../../src/table/v1Table';

// The batter must swing at the pitch (docs/MVP/01 § 4.1). The physics calls each pitch once, on
// its first touch with a bat before any swing has struck it: a `bunt` if that bat is held out (it
// has finished its stroke on this press), a `take` if it is at rest (button up). A swing that
// strikes the pitch on the way up is neither: a struck ball always leaves the bat before its
// stroke ends.

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
const takes = (events: PhysicsEvent[]) => events.filter((e) => e.type === 'take');
const TYPES: PitchType[] = ['FB', 'CH', 'CB'];
const SIDES: Side[] = ['L', 'R'];

describe('calling the pitch: bunt, take or swing', () => {
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
        expect(takes(events)).toEqual([]);
      });

      it(`${type} to ${side}: no swing at all takes the pitch on first touch`, () => {
        const { events } = pitchAt(type, side, 9, 0);
        const first = events.find((e) => e.type !== 'eos');
        expect(first).toMatchObject({ type: 'take', id: `flipper.${side}` });
        expect(takes(events)).toHaveLength(1);
        expect(bunts(events)).toEqual([]);
      });

      it(`${type} to ${side}: early is a bunt, late a take, and in between a clean swing`, () => {
        let swings = 0;
        let early = 0;
        let late = 0;
        for (let ms = 150; ms <= 650; ms += 3) {
          const { events, contact } = pitchAt(type, side, ms / 1000, 2);
          const calls = [...bunts(events), ...takes(events)];
          // One call per pitch, at most.
          expect(calls.length, `press at ${ms} ms`).toBeLessThanOrEqual(1);
          if (calls.length === 0) {
            // A swing struck it on the way up (or as the bat reached its stop), and nothing after
            // that (a ball back on the bat still held up after the swing) is a call.
            expect(['swing', 'settling'], `press at ${ms} ms`).toContain(contact);
            swings++;
          } else if (calls[0]!.type === 'bunt') {
            expect(swings, `press at ${ms} ms: a bunt after the swing window`).toBe(0);
            early++;
          } else {
            late++;
          }
        }
        // A fair window to swing in (about 0.1 s of press timing), with the calls either side.
        expect(swings).toBeGreaterThan(30);
        expect(early).toBeGreaterThan(0);
        expect(late).toBeGreaterThan(0);
      });
    }
  }

  it('a bat dropping after an early press takes the pitch', () => {
    // Pressed and let go before the pitch arrives: no swing at it.
    const { events } = pitchAt('FB', 'L', 0, 0.25);
    expect(takes(events)).toHaveLength(1);
    expect(bunts(events)).toEqual([]);
  });

  it('only a pitch is called: a ball set down on a bat (a rally cradle) is neither', () => {
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
    // Let it go: it rolls down the resting bat.
    w.setFlipper('flipper.L', false);
    for (let i = 0; i < 500; i++) w.step();
    expect(takes(w.events)).toEqual([]);
  });
});
