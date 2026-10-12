import { describe, expect, it } from 'vitest';
import { emptyTable, makeWorld, runFor } from './helpers';
import type { PhysicsEvent } from '../../src/physics/world';

function collect(w: { events: PhysicsEvent[] }, into: PhysicsEvent[]) {
  return () => {
    into.push(...w.events);
    w.events.length = 0;
  };
}

describe('devices', () => {
  it('pop bumper kicks the ball away at kick speed', () => {
    const w = makeWorld(emptyTable([{ type: 'pop', id: 'pop', x: 300, y: 400, radius: 22 }]));
    const b = w.addBall(0.3, 0.33);
    b.vy = 1;
    const events: PhysicsEvent[] = [];
    runFor(w, 0.1, collect(w, events));
    expect(events.filter((e) => e.type === 'pop')).toHaveLength(1);
    expect(b.vy).toBeLessThan(-w.params.popKickSpeed * 0.9);
  });

  describe('ramp-and-bumper wedge', () => {
    // Centre (300, 400), radius 22: ramp from y = 378 up to y = 400, bumper face round the back.
    const mound = (): ReturnType<typeof makeWorld> =>
      makeWorld({
        ...emptyTable([
          { type: 'rampBumper', id: 'pop.m', x: 300, y: 400, radius: 22, height: 10 },
        ]),
        pitchSpot: { x: 300, y: 395 },
      });
    const raise = (w: ReturnType<typeof makeWorld>): void => {
      w.setPopRaised('pop.m', true);
      runFor(w, 0.3);
      expect(w.popLift('pop.m')).toBe(1);
    };
    const pops = (ev: PhysicsEvent[]): number => ev.filter((e) => e.type === 'pop').length;
    /** Send a ball up (from below the wedge) or down (from above it) the line x = 300. */
    const send = (w: ReturnType<typeof makeWorld>, up: boolean, speed: number) => {
      const b = w.addBall(0.3, up ? 0.34 : 0.46);
      b.vy = up ? speed : -speed;
      const ev: PhysicsEvent[] = [];
      runFor(w, 0.5, collect(w, ev));
      return { b, ev };
    };

    it('starts lowered, and a ball rolls straight over it in either direction', () => {
      const w = mound();
      expect(w.popLift('pop.m')).toBe(0);
      const up = send(w, true, 2);
      expect(up.b.py).toBeGreaterThan(0.43);
      expect(pops(up.ev)).toBe(0);
      const w2 = mound();
      const down = send(w2, false, 2);
      expect(down.b.py).toBeLessThan(0.37);
      expect(pops(down.ev)).toBe(0);
    });

    it('a ball from below rides up the ramp and over the top without being kicked', () => {
      const w = mound();
      raise(w);
      const { b, ev } = send(w, true, 2);
      expect(b.py).toBeGreaterThan(0.43);
      expect(pops(ev)).toBe(0);
    });

    it('a slow ball from below rolls back down the ramp', () => {
      const w = mound();
      raise(w);
      const { b } = send(w, true, 0.3);
      expect(b.py).toBeLessThan(0.38);
    });

    it('a ball from above is kicked back up the table by the bumper face', () => {
      const w = mound();
      raise(w);
      const { b, ev } = send(w, false, 1.5);
      expect(pops(ev)).toBe(1);
      expect(b.py).toBeGreaterThan(0.45);
    });

    it('sinks flush when lowered', () => {
      const w = mound();
      raise(w);
      w.setPopRaised('pop.m', false);
      runFor(w, 0.3);
      expect(w.popLift('pop.m')).toBe(0);
      const { ev } = send(w, false, 1.5);
      expect(pops(ev)).toBe(0);
    });

    it('never rises under a ball; it waits until the ball has gone', () => {
      const w = mound();
      const b = w.addBall(0.3, 0.4);
      w.setPopRaised('pop.m', true);
      // The ball creeps down the slope but is still over the footprint.
      runFor(w, 0.1);
      expect(w.popLift('pop.m')).toBe(0);
      expect(b.py).toBeGreaterThan(0.39);
      b.place(0.3, 0.5);
      runFor(w, 0.3);
      expect(w.popLift('pop.m')).toBe(1);
    });

    it('drops out of the way of a pitch and rises again once the ball has left', () => {
      const w = mound();
      raise(w);
      const ev: PhysicsEvent[] = [];
      w.pitchBall(0.3, 0.1, 3);
      expect(w.popLift('pop.m')).toBe(0);
      runFor(w, 0.5, collect(w, ev));
      expect(pops(ev)).toBe(0);
      expect(w.balls[0]!.py).toBeLessThan(0.3);
      expect(w.popLift('pop.m')).toBe(1);
    });
  });

  it('slingshot only fires above its threshold', () => {
    const sling = {
      type: 'sling' as const,
      id: 'sl',
      corner: [200, 300] as const,
      top: [200, 450] as const,
      bottom: [300, 300] as const,
    };
    const fast = makeWorld(emptyTable([sling]));
    const b = fast.addBall(0.3, 0.42);
    b.vx = -1.5;
    b.vy = -1.0;
    const ev: PhysicsEvent[] = [];
    runFor(fast, 0.2, collect(fast, ev));
    expect(ev.some((e) => e.type === 'sling')).toBe(true);

    const slow = makeWorld(emptyTable([sling]));
    const b2 = slow.addBall(0.275, 0.4);
    b2.vx = -0.1;
    b2.vy = -0.1;
    const ev2: PhysicsEvent[] = [];
    runFor(slow, 0.3, collect(slow, ev2));
    expect(ev2.some((e) => e.type === 'sling')).toBe(false);
  });

  it('drop target falls when hit hard and lets the ball through', () => {
    const w = makeWorld(emptyTable([{ type: 'drop', id: 'd', a: [250, 400], b: [350, 400] }]));
    const b = w.addBall(0.3, 0.35);
    b.vy = 2;
    const ev: PhysicsEvent[] = [];
    runFor(w, 0.05, collect(w, ev));
    expect(ev.some((e) => e.type === 'drop')).toBe(true);
    expect(w.isDropDown('d')).toBe(true);
  });

  it('saucer captures a slow ball and lets a fast one skim across', () => {
    const saucer = {
      type: 'saucer' as const,
      id: 's',
      x: 300,
      y: 400,
      radius: 20,
      depth: 7,
      lipAngle: 90,
    };
    const slow = makeWorld(emptyTable([saucer]));
    const b = slow.addBall(0.3, 0.34);
    b.vy = 0.45;
    const ev: PhysicsEvent[] = [];
    runFor(slow, 1.5, collect(slow, ev));
    expect(ev.some((e) => e.type === 'saucer')).toBe(true);

    const fast = makeWorld(emptyTable([saucer]));
    const b2 = fast.addBall(0.24, 0.36);
    b2.vx = 3;
    b2.vy = 0.5;
    const ev2: PhysicsEvent[] = [];
    runFor(fast, 0.3, collect(fast, ev2));
    expect(ev2.some((e) => e.type === 'saucer')).toBe(false);
  });

  it('drains below the drain line', () => {
    const w = makeWorld();
    const b = w.addBall(0.275, 0.12);
    const ev: PhysicsEvent[] = [];
    runFor(w, 1, collect(w, ev));
    expect(b.active).toBe(false);
    expect(ev.some((e) => e.type === 'drain')).toBe(true);
  });
});
