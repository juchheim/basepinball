import { describe, expect, it, vi } from 'vitest';
import { FixedLoop } from '../../src/app/loop';
import { v1Table } from '../../src/table/v1Table';
import type { World } from '../../src/physics/world';
import { makeWorld } from './helpers';

// Physics sleep (docs/MVP/efficiency-audit F17): a world at rest stops simulating, and comes back
// with the state (to 1e-9) and the events stepping would have given.

/** A v1 world with a ball served onto the plunger. */
function served(): World {
  const w = makeWorld(v1Table);
  w.reset();
  w.serveBall();
  return w;
}

/** Advance one step: sleep when the world allows it (as FixedLoop does), else step. */
const advance = (w: World): boolean => w.idle() || (w.step(), false);

/** Position and velocity of every ball (not orientation: a sleeping ball does not turn). */
function state(w: World): number[] {
  return w.balls.flatMap((b) => [b.px, b.py, b.pz, b.vx, b.vy, b.vz]);
}

function expectSame(a: World, b: World): void {
  const sa = state(a);
  state(b).forEach((v, i) => expect(v).toBeCloseTo(sa[i]!, 9));
}

describe('physics sleep', () => {
  it('a ball resting on the plunger puts the world to sleep within a fraction of a second', () => {
    const w = served();
    let slept = 0;
    for (let i = 0; i < 2000; i++) if (advance(w)) slept++;
    expect(w.restingSteps).toBeGreaterThanOrEqual(100);
    expect(slept).toBeGreaterThan(1500);
  });

  it('sleeping gives the same state as stepping, before and after a plunge', () => {
    const a = served();
    const b = served();
    for (let i = 0; i < 2000; i++) {
      a.step();
      advance(b);
    }
    expectSame(a, b);
    // Plunge both: the sleeper wakes on the plunger and follows the same path.
    for (const w of [a, b]) {
      w.setPlungerPull(1);
      for (let i = 0; i < 600; i++) w.step();
      w.setPlunger(false);
    }
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    for (let i = 0; i < 3000; i++) {
      a.step();
      advance(b);
      eventsA.push(...a.events.map((e) => `${e.type}:${e.id}`));
      eventsB.push(...b.events.map((e) => `${e.type}:${e.id}`));
      a.events.length = b.events.length = 0;
      a.impacts.length = b.impacts.length = 0;
    }
    expect(eventsA.length).toBeGreaterThan(0);
    expect(eventsB).toEqual(eventsA);
    expectSame(a, b);
  });

  it('a held flipper keeps the world awake (swing timing depends on the clock)', () => {
    const w = served();
    for (let i = 0; i < 500; i++) advance(w);
    w.setFlipper('flipper.L', true);
    let slept = 0;
    for (let i = 0; i < 1000; i++) if (advance(w)) slept++;
    expect(slept).toBe(0);
    w.setFlipper('flipper.L', false);
    for (let i = 0; i < 1000; i++) if (advance(w)) slept++;
    expect(slept).toBeGreaterThan(500);
  });

  it('anything changed from outside wakes it at once (a new ball, a reset)', () => {
    const w = served();
    for (let i = 0; i < 500; i++) advance(w);
    expect(w.idle()).toBe(true);
    w.ball().place(0.3, 0.6);
    expect(w.idle()).toBe(false);
  });

  it('the fixed loop keeps the clock and the per-step callbacks running while asleep', () => {
    const w = served();
    const stepSpy = vi.spyOn(w, 'step');
    let callbacks = 0;
    const loop = new FixedLoop(
      () => w,
      () => callbacks++,
      0,
      120,
    );
    for (let t = 16; t <= 2000; t += 16) loop.frame(t);
    expect(callbacks).toBeGreaterThan(1900);
    expect(w.time).toBeGreaterThan(1.9);
    // Only the first ~0.1 s (plus settling) is simulated.
    expect(stepSpy.mock.calls.length).toBeLessThan(400);
  });
});
